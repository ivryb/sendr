import { env } from "cloudflare:workers"
import { and, eq } from "drizzle-orm"

import { renderEmail } from "../../shared/render"
import { db } from "../db/client"
import { contacts, deliveries } from "../db/schema"
import { PermanentSendError, type EmailProvider } from "../email/provider"
import { senderProvider } from "../email/providers"
import { signToken } from "../lib/crypto"
import { senderAddress } from "../../shared/model"
import { getSettings, type InstanceSettings } from "../lib/settings"
import { advanceCampaign, CampaignError, findCampaign, type SendMessage } from "./campaigns"
import { campaignSender } from "./senders"
import { trackEmail } from "./tracking"

export const UNSUBSCRIBE_PURPOSE = "unsubscribe"

const DELIVERIES_PER_MESSAGE = 100

/**
 * Queue consumer: sends the campaign's next queued deliveries at the provider's pace, then
 * queues itself again until the current batch is done. The consumer runs one message at a
 * time, so there is never more than one sender per campaign, and a redelivered message only
 * finds deliveries that are still queued.
 */
export async function processSendMessage({ campaignId }: SendMessage) {
  const campaign = await findCampaign(campaignId).catch(() => null)
  if (campaign?.status !== "first_batch" && campaign?.status !== "sending") return

  const settings = await getSettings()
  // Senders can't be removed while their campaign sends, so this only fails on a broken database.
  const sender = await campaignSender(campaign)
  if (!sender) throw new Error(`Campaign ${campaignId} has no sender.`)
  const provider = senderProvider(sender)
  const rows = await db()
    .select({ delivery: deliveries, contact: contacts })
    .from(deliveries)
    .leftJoin(contacts, eq(deliveries.contactId, contacts.id))
    .where(
      and(
        eq(deliveries.campaignId, campaignId),
        eq(deliveries.batch, campaign.status === "first_batch" ? "first" : "rest"),
        eq(deliveries.status, "queued")
      )
    )
    .limit(DELIVERIES_PER_MESSAGE)

  const pace = pacer(provider)
  for (const { delivery, contact } of rows) {
    if (contact?.status !== "subscribed") {
      await markDelivery(delivery.id, { status: "skipped" })
      continue
    }
    await pace()
    const url = await unsubscribeUrl(settings, contact.id)
    const email = renderEmail({
      subject: campaign.subject,
      format: campaign.format,
      body: campaign.body,
      footer: settings.footer,
      recipient: contact,
      unsubscribeUrl: url,
    })
    const tracked = await trackEmail(email, {
      settings,
      deliveryId: delivery.id,
      unsubscribeUrl: url,
    })
    try {
      const { providerMessageId } = await provider.send({
        from: senderAddress(sender),
        replyTo: sender.replyTo || undefined,
        to: contact.email,
        ...tracked,
        headers: unsubscribeHeaders(url),
      })
      // A crash between the send and this write resends one email on retry. That rare
      // duplicate is preferred over marking deliveries sent before the provider accepts them.
      await markDelivery(delivery.id, {
        status: "sent",
        providerMessageId,
        sentAt: new Date(),
      })
    } catch (error) {
      if (!(error instanceof PermanentSendError)) throw error
      await markDelivery(delivery.id, { status: "failed", error: error.message })
    }
  }
  if (rows.length === DELIVERIES_PER_MESSAGE) {
    await env.SEND_QUEUE.send({ campaignId })
  } else {
    await advanceCampaign(campaignId)
  }
}

/** Sends the campaign as it would reach one recipient, to the admin, without touching stats. */
export async function sendTestEmail(
  campaignId: string,
  to: { email: string; name: string }
) {
  const campaign = await findCampaign(campaignId)
  const sender = await campaignSender(campaign)
  if (!sender) throw new CampaignError("not_ready", "Choose who this campaign is from first.")
  const settings = await getSettings()
  const url = `${settings.publicUrl}/u/test`
  const email = renderEmail({
    subject: `[Test] ${campaign.subject}`,
    format: campaign.format,
    body: campaign.body,
    footer: settings.footer,
    recipient: { firstName: to.name.split(" ")[0] || null, fields: {} },
    unsubscribeUrl: url,
  })
  await senderProvider(sender).send({
    from: senderAddress(sender),
    replyTo: sender.replyTo || undefined,
    to: to.email,
    ...email,
  })
}

export async function unsubscribeUrl(settings: InstanceSettings, contactId: string) {
  return `${settings.publicUrl}/u/${await signToken(settings.secret, UNSUBSCRIBE_PURPOSE, contactId)}`
}

/** RFC 8058 one-click unsubscribe, shown by Gmail and Apple Mail as their own button. */
function unsubscribeHeaders(url: string) {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  }
}

function markDelivery(id: string, values: Partial<typeof deliveries.$inferInsert>) {
  return db().update(deliveries).set(values).where(eq(deliveries.id, id))
}

/** Spaces sends so the provider's rate limit is never exceeded. */
function pacer(provider: EmailProvider) {
  const interval = 1000 / provider.maxSendsPerSecond
  let next = 0
  return async () => {
    const wait = next - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    next = Math.max(next, Date.now()) + interval
  }
}
