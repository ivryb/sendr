import { and, asc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import type { DnsRecord, Sender } from "../../shared/model"
import { db } from "../db/client"
import { campaigns, senders, type SenderRow } from "../db/schema"
import { AwsError, sesAccount } from "../email/ses-account"
import { DomainError } from "../lib/errors"
import { getSettings, type InstanceSettings } from "../lib/settings"


export const senderInput = z.object({
  name: z.string().trim(),
  email: z.email().transform((email) => email.trim().toLowerCase()),
  replyTo: z.union([z.email(), z.literal("")]).default(""),
  region: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/, "Pick an AWS region."),
  accessKeyId: z.string().trim().min(16, "Paste the whole access key ID."),
  secretAccessKey: z.string().trim().min(30, "Paste the whole secret access key."),
})

export const senderChanges = senderInput.pick({ name: true, replyTo: true }).partial()

const SENDER_ERROR_STATUS = { not_found: 404, invalid: 400 } as const

/** Something the admin can fix, like a key without the right permissions. */
export class SenderError extends DomainError {
  declare readonly code: keyof typeof SENDER_ERROR_STATUS
  constructor(code: keyof typeof SENDER_ERROR_STATUS, message: string) {
    super(code, SENDER_ERROR_STATUS[code], message)
  }
}

/**
 * Checks the key, then sets up SES for this sender: delivery reports sent to this instance
 * through SNS, and verification of the address's domain.
 */
export async function connectSender(input: z.infer<typeof senderInput>, settings: InstanceSettings) {
  // SNS only delivers reports to a public https address.
  if (!settings.publicUrl.startsWith("https://")) {
    throw new SenderError(
      "invalid",
      "Set this Sendr's https address as the public URL in Settings first. Delivery reports are sent there."
    )
  }
  const ses = sesAccount(input)
  const domain = domainOf(input.email)
  const setup = async () => {
    const account = await ses.account()
    const events = await ses.connectEvents(eventsUrl(settings))
    await ses.addDomain(domain)
    return { ...account, events }
  }
  const { production, maxSendRate, events } = await setup().catch((error) => {
    throw explain(error)
  })
  const [row] = await db()
    .insert(senders)
    .values({
      ...input,
      provider: "ses",
      production,
      maxSendRate,
      eventsTopicArn: events.topicArn,
      eventsConnected: events.confirmed,
    })
    .returning()
  return toSenderDto(row)
}

export async function listSenders() {
  const rows = await db().select().from(senders).orderBy(asc(senders.createdAt))
  return rows.map(toSenderDto)
}

/** The sender's state at its provider: domain records, sandbox, reports. Also saved for lists. */
export async function checkSender(id: string) {
  const row = await findSender(id)
  const ses = sesAccount(row)
  const domain = domainOf(row.email)
  // AWS's confirmation can arrive before the sender is saved; asking again settles it.
  const eventsConnected = async () =>
    row.eventsConnected ||
    (row.eventsTopicArn !== null && (await ses.subscribe(row.eventsTopicArn, eventsUrl(await getSettings()))))
  try {
    const [identity, account, connected] = await Promise.all([
      ses.domain(domain),
      ses.account(),
      eventsConnected(),
    ])
    const status = {
      verified: identity.verified,
      production: account.production,
      maxSendRate: account.maxSendRate,
      eventsConnected: connected,
    }
    await db().update(senders).set(status).where(eq(senders.id, id))
    return {
      ok: true as const,
      sender: toSenderDto({ ...row, ...status }),
      domain,
      records: dnsRecords(domain, row.region, identity),
      max24HourSend: account.max24HourSend,
      maxSendRate: account.maxSendRate,
    }
  } catch (error) {
    return { ok: false as const, sender: toSenderDto(row), error: explain(error).message }
  }
}

export async function updateSender(id: string, changes: z.infer<typeof senderChanges>) {
  await findSender(id)
  const [row] = await db().update(senders).set(changes).where(eq(senders.id, id)).returning()
  return toSenderDto(row)
}

/** Campaigns that are sending need their sender, so it can only go once they finish. */
export async function deleteSender(id: string) {
  await findSender(id)
  const [sending] = await db()
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.senderId, id),
        inArray(campaigns.status, ["first_batch", "awaiting_approval", "sending"])
      )
    )
    .limit(1)
  if (sending) {
    throw new SenderError("invalid", "A campaign is still sending from this address. Remove it once that campaign finishes.")
  }
  await db().delete(senders).where(eq(senders.id, id))
}

export async function findSender(id: string) {
  const row = await db().query.senders.findFirst({ where: eq(senders.id, id) })
  if (!row) throw new SenderError("not_found", "Sender not found.")
  return row
}

/** The oldest verified sender: it sends login codes, and new campaigns start with it. */
export async function defaultSender() {
  const rows = await db().select().from(senders).orderBy(asc(senders.createdAt))
  return rows.find((row) => row.verified) ?? rows[0] ?? null
}

/** Delivery reports for any sender in this AWS account have arrived, or AWS confirmed them. */
export async function markEventsConnected(topicArn: string) {
  await db().update(senders).set({ eventsConnected: true }).where(eq(senders.eventsTopicArn, topicArn))
}

/** The campaign's sender, or null when it has none. */
export async function campaignSender(campaign: typeof campaigns.$inferSelect) {
  if (!campaign.senderId) return null
  return (await db().query.senders.findFirst({ where: eq(senders.id, campaign.senderId) })) ?? null
}

function eventsUrl(settings: InstanceSettings) {
  return `${settings.publicUrl}/hooks/ses/${settings.webhookSecret}`
}

function domainOf(email: string) {
  return email.split("@")[1].toLowerCase()
}

function dnsRecords(
  domain: string,
  region: string,
  identity: Awaited<ReturnType<ReturnType<typeof sesAccount>["domain"]>>
): DnsRecord[] {
  const dkim: DnsRecord["status"] = identity.dkimVerified ? "verified" : "pending"
  const mailFrom: DnsRecord["status"] = identity.mailFromVerified ? "verified" : "pending"
  return [
    ...identity.dkimTokens.map((token): DnsRecord => ({
      type: "CNAME",
      name: `${token}._domainkey.${domain}`,
      value: `${token}.dkim.amazonses.com`,
      status: dkim,
    })),
    {
      type: "MX",
      name: identity.mailFromDomain,
      value: `10 feedback-smtp.${region}.amazonses.com`,
      status: mailFrom,
    },
    {
      type: "TXT",
      name: identity.mailFromDomain,
      value: '"v=spf1 include:amazonses.com ~all"',
      status: mailFrom,
    },
    { type: "TXT", name: `_dmarc.${domain}`, value: '"v=DMARC1; p=none;"', status: "recommended" },
  ]
}

/** AWS errors in words the admin can act on. */
function explain(error: unknown) {
  if (!(error instanceof AwsError)) return error instanceof Error ? error : new Error(String(error))
  if ([
      "UnrecognizedClientException",
      "InvalidClientTokenId",
      "InvalidSignatureException",
      "SignatureDoesNotMatch",
    ].includes(error.code)) {
    return new SenderError("invalid", "AWS didn't accept this access key. Check both parts and the region.")
  }
  if (["AccessDeniedException", "AuthorizationError", "AccessDenied"].includes(error.code)) {
    return new SenderError("invalid", `The key is missing a permission. Attach the policy shown above. AWS said: ${error.message}`)
  }
  return new SenderError("invalid", `AWS refused: ${error.message}`)
}

function toSenderDto(row: SenderRow): Sender {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    replyTo: row.replyTo,
    provider: row.provider,
    region: row.region,
    verified: row.verified,
    production: row.production,
    eventsConnected: row.eventsConnected,
    createdAt: row.createdAt.toISOString(),
  }
}
