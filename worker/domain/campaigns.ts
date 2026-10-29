import { env } from "cloudflare:workers"
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { z } from "zod"

import {
  CAMPAIGN_ACTIONS,
  CAMPAIGN_FORMATS,
  CAMPAIGN_STATUSES,
  DELIVERY_STATUSES,
  FIRST_BATCH_MAX,
  SUBJECT_MAX,
  type Campaign,
  type CampaignAction,
  type CampaignCounts,
  type CampaignStatus,
  type DeliveryStatus,
} from "../../shared/model"
import { markdownToHtml } from "../../shared/render"
import { db } from "../db/client"
import { campaigns, deliveries } from "../db/schema"
import { DomainError } from "../lib/errors"
import type { InstanceSettings } from "../lib/settings"
import { contactCounts } from "./contacts"
import { checkSender, defaultSender } from "./senders"

export const campaignInput = z
  .object({
    senderId: z.string().nullable().optional(),
    subject: z.string().max(SUBJECT_MAX).optional(),
    format: z.enum(CAMPAIGN_FORMATS).optional(),
    body: z.string().optional(),
    // Agents write Markdown well, so it's accepted and stored as an editor body.
    markdown: z.string().optional(),
    firstBatchSize: z.number().int().min(1).max(FIRST_BATCH_MAX).optional(),
  })
  .refine((input) => input.markdown === undefined || input.body === undefined, {
    message: "Send the message as `body` or `markdown`, not both.",
    path: ["markdown"],
  })
  .transform(({ markdown, ...input }) =>
    markdown === undefined
      ? input
      : { ...input, format: "editor" as const, body: markdownToHtml(markdown) }
  )

/** One queue message sends the campaign's next deliveries, then queues the next message. */
export type SendMessage = { campaignId: string }

const CAMPAIGN_ERROR_STATUS = { not_found: 404, invalid_action: 409, not_ready: 400 } as const

export class CampaignError extends DomainError {
  declare readonly code: keyof typeof CAMPAIGN_ERROR_STATUS
  constructor(code: keyof typeof CAMPAIGN_ERROR_STATUS, message: string) {
    super(code, CAMPAIGN_ERROR_STATUS[code], message)
  }
}

export async function createCampaign(input: z.infer<typeof campaignInput>) {
  const senderId = input.senderId === undefined ? (await defaultSender())?.id : input.senderId
  const [row] = await db().insert(campaigns).values({ ...input, senderId }).returning()
  return toCampaignDto(row, emptySummary())
}

export async function listCampaigns(): Promise<Campaign[]> {
  const rows = await db().select().from(campaigns).orderBy(desc(campaigns.createdAt))
  const summaries = await deliverySummaries()
  return rows.map((row) => toCampaignDto(row, summaries.get(row.id) ?? emptySummary()))
}

export async function getCampaign(id: string): Promise<Campaign> {
  const row = await findCampaign(id)
  const summaries = await deliverySummaries(id)
  return toCampaignDto(row, summaries.get(id) ?? emptySummary())
}

export async function updateDraft(id: string, input: z.infer<typeof campaignInput>) {
  await assertStatus(id, ["draft"])
  await db().update(campaigns).set(input).where(eq(campaigns.id, id))
  return getCampaign(id)
}

export async function deleteDraft(id: string) {
  await assertStatus(id, ["draft"])
  await db().delete(campaigns).where(eq(campaigns.id, id))
}

/**
 * Snapshots every subscribed contact into a queued delivery, then sends the first batch.
 * Contacts who subscribe later are not added to a running campaign.
 */
export async function startCampaign(id: string, settings: InstanceSettings) {
  const campaign = await findCampaign(id)
  assertAction(campaign.status, "start")
  const missing = [
    !campaign.subject.trim() && "a subject",
    !campaign.body.trim() && "a message",
    !campaign.senderId && "a sender",
    !settings.publicUrl && "a public URL in Settings",
  ].filter(Boolean)
  if (missing.length || !campaign.senderId) {
    throw new CampaignError("not_ready", `Add ${missing.join(", ")} before sending.`)
  }
  // Checked live: an unverified address would make every email in the campaign fail.
  const check = await checkSender(campaign.senderId)
  if (!check.ok || !check.sender.verified) {
    throw new CampaignError(
      "not_ready",
      `${check.sender.email} isn't verified yet. Finish its setup in Senders before sending.`
    )
  }
  // In the SES sandbox every unverified recipient fails, and first-batch contacts that fail
  // never get the campaign, since approving sends only to the rest.
  if (!check.sender.production) {
    throw new CampaignError(
      "not_ready",
      `${check.sender.email}'s SES account is still in the sandbox, so it only sends to addresses verified in SES. Request production access from its page in Senders, then start the campaign.`
    )
  }
  // SES refuses everything past its 24-hour quota, so a bigger list would stall partway.
  const { subscribed } = await contactCounts()
  const left = Math.max(0, check.max24HourSend - check.sentLast24Hours)
  if (check.max24HourSend >= 0 && subscribed > left) {
    throw new CampaignError(
      "not_ready",
      `${check.sender.email}'s SES account can send ${left.toLocaleString("en-US")} more emails in the next 24 hours, and this campaign goes to ${subscribed.toLocaleString("en-US")} contacts. Ask AWS for a higher sending quota, or start it once the last day's emails leave the quota.`
    )
  }

  // Idempotent: a repeated or concurrent start inserts nothing new, and only one request
  // wins the draft -> first_batch transition below.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO deliveries (id, campaign_id, contact_id, batch, status)
     SELECT lower(hex(randomblob(16))), ?1, id,
       CASE WHEN row_number() OVER (ORDER BY created_at, rowid) <= ?2 THEN 'first' ELSE 'rest' END,
       'queued'
     FROM contacts WHERE status = 'subscribed'`
  )
    .bind(id, campaign.firstBatchSize)
    .run()
  if (!(await transition(id, ["draft"], "first_batch", { startedAt: new Date() }))) {
    throw new CampaignError("invalid_action", "This campaign was already started.")
  }
  await env.SEND_QUEUE.send({ campaignId: id })
  return getCampaign(id)
}

export async function approveCampaign(id: string) {
  assertAction((await findCampaign(id)).status, "approve")
  if (!(await transition(id, statusesAllowing("approve"), "sending"))) {
    throw new CampaignError("invalid_action", "This campaign is no longer waiting for approval.")
  }
  await env.SEND_QUEUE.send({ campaignId: id })
  return getCampaign(id)
}

export async function cancelCampaign(id: string) {
  assertAction((await findCampaign(id)).status, "cancel")
  await transition(id, statusesAllowing("cancel"), "cancelled", {
    finishedAt: new Date(),
  })
  return getCampaign(id)
}

/** Moves a campaign on once its current batch has no queued deliveries left. */
export async function advanceCampaign(id: string) {
  const { status } = await findCampaign(id)
  if (status !== "first_batch" && status !== "sending") return
  const batch = status === "first_batch" ? "first" : "rest"
  const queued = await db()
    .select({ batch: deliveries.batch, count: sql<number>`count(*)` })
    .from(deliveries)
    .where(and(eq(deliveries.campaignId, id), eq(deliveries.status, "queued")))
    .groupBy(deliveries.batch)
  const remaining = (name: "first" | "rest") =>
    queued.find((row) => row.batch === name)?.count ?? 0
  if (remaining(batch) > 0) return

  if (status === "first_batch" && remaining("rest") > 0) {
    await transition(id, ["first_batch"], "awaiting_approval")
  } else {
    await transition(id, [status], "sent", { finishedAt: new Date() })
  }
}

export async function findCampaign(id: string) {
  const row = await db().query.campaigns.findFirst({ where: eq(campaigns.id, id) })
  if (!row) throw new CampaignError("not_found", "Campaign not found.")
  return row
}

async function assertStatus(id: string, allowed: CampaignStatus[]) {
  const { status } = await findCampaign(id)
  if (!allowed.includes(status)) {
    throw new CampaignError("invalid_action", "Only drafts can be changed.")
  }
}

function statusesAllowing(action: CampaignAction) {
  return CAMPAIGN_STATUSES.filter((status) => CAMPAIGN_ACTIONS[status].includes(action))
}

function assertAction(status: CampaignStatus, action: CampaignAction) {
  if (!CAMPAIGN_ACTIONS[status].includes(action)) {
    throw new CampaignError("invalid_action", `Can't ${action} a campaign that is ${status}.`)
  }
}

/** Conditional status change, so concurrent requests can't both win the same transition. */
async function transition(
  id: string,
  from: CampaignStatus[],
  to: CampaignStatus,
  extra: Partial<typeof campaigns.$inferInsert> = {}
) {
  const updated = await db()
    .update(campaigns)
    .set({ status: to, ...extra })
    .where(and(eq(campaigns.id, id), inArray(campaigns.status, from)))
    .returning({ id: campaigns.id })
  return updated.length > 0
}

type DeliverySummary = { counts: CampaignCounts; lastSentAt: Date | null }

const statusCounts = Object.fromEntries(
  DELIVERY_STATUSES.map((status) => [status, sql<number>`sum(${deliveries.status} = ${status})`])
) as Record<DeliveryStatus, SQL<number>>

/**
 * Counts for one campaign, or for all of them (the list never binds a growing ID list). One
 * pass over the deliveries: grouping by status as well makes D1 read every row twice.
 */
async function deliverySummaries(campaignId?: string) {
  const rows = await db()
    .select({
      campaignId: deliveries.campaignId,
      lastSentAt: sql<Date | null>`max(${deliveries.sentAt})`.mapWith(deliveries.sentAt),
      total: sql<number>`count(*)`,
      opened: sql<number>`count(${deliveries.openedAt})`,
      clicked: sql<number>`count(${deliveries.clickedAt})`,
      ...statusCounts,
    })
    .from(deliveries)
    .where(campaignId ? eq(deliveries.campaignId, campaignId) : undefined)
    .groupBy(deliveries.campaignId)
  return new Map<string, DeliverySummary>(
    rows.map(({ campaignId, lastSentAt, ...counts }) => [campaignId, { counts, lastSentAt }])
  )
}

function emptySummary(): DeliverySummary {
  const counts = Object.assign(
    { total: 0, opened: 0, clicked: 0 },
    Object.fromEntries(DELIVERY_STATUSES.map((status) => [status, 0]))
  ) as CampaignCounts
  return { counts, lastSentAt: null }
}

// Delivery reports mostly arrive within the hour after an email; an open page then stops
// refreshing, since each refresh reads every delivery and Workers Free allows 5 million a day.
const REPORTS_WITHIN = 60 * 60_000
// The queue retries a failing message for about ten minutes before it gives up.
const STALLED_AFTER = 5 * 60_000

function toCampaignDto(
  row: typeof campaigns.$inferSelect,
  { counts, lastSentAt }: DeliverySummary
): Campaign {
  // Only transitions update a started campaign, so updatedAt is when it started, was approved,
  // or finished.
  const progressAt =
    row.startedAt && new Date(Math.max(row.updatedAt.getTime(), lastSentAt?.getTime() ?? 0))
  const sending = row.status === "first_batch" || row.status === "sending"
  // Decided here rather than in the browser, whose data can be old: a hidden tab, or a slow
  // refresh of a big campaign.
  const quietFor = progressAt ? Date.now() - progressAt.getTime() : Infinity
  return {
    id: row.id,
    subject: row.subject,
    format: row.format,
    body: row.body,
    status: row.status,
    senderId: row.senderId,
    firstBatchSize: row.firstBatchSize,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    progressAt: progressAt?.toISOString() ?? null,
    // A stalled send stops refreshing too, so a dead queue message doesn't keep an open page
    // re-reading its deliveries until someone cancels it.
    live: quietFor < REPORTS_WITHIN,
    stalled: sending && quietFor > STALLED_AFTER,
    counts,
  }
}
