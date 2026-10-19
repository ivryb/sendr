/** Domain vocabulary shared by the Worker and the admin app. */

export const CONTACT_STATUSES = [
  "subscribed",
  "unsubscribed",
  "bounced",
  "complained",
] as const
export type ContactStatus = (typeof CONTACT_STATUSES)[number]

export const DELIVERY_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  // The contact unsubscribed or was deleted after the campaign started.
  "skipped",
] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export const CAMPAIGN_STATUSES = [
  "draft",
  "first_batch",
  "awaiting_approval",
  "sending",
  "sent",
  "cancelled",
] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

export type CampaignAction = "start" | "approve" | "cancel"

/** Actions the operator can take from each campaign status. */
export const CAMPAIGN_ACTIONS: Record<CampaignStatus, CampaignAction[]> = {
  draft: ["start"],
  first_batch: ["cancel"],
  awaiting_approval: ["approve", "cancel"],
  sending: ["cancel"],
  sent: [],
  cancelled: [],
}

export type CampaignCounts = Record<DeliveryStatus, number> & { total: number }

export type Campaign = {
  id: string
  subject: string
  markdown: string
  status: CampaignStatus
  firstBatchSize: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  counts: CampaignCounts
}

export type Contact = {
  id: string
  externalId: string | null
  email: string
  firstName: string | null
  fields: Record<string, string>
  status: ContactStatus
  createdAt: string
}

export type Settings = {
  fromName: string
  fromEmail: string
  replyTo: string
  footer: string
  publicUrl: string
  webhookSecret: string
}

export type ApiKey = {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
}

/** `"Acme, Inc." <hi@acme.com>`: quoted, because a comma in a bare name splits the address. */
export function senderAddress(sender: { fromName: string; fromEmail: string }) {
  if (!sender.fromName) return sender.fromEmail
  return `"${sender.fromName.replace(/["\\]/g, "\\$&")}" <${sender.fromEmail}>`
}
