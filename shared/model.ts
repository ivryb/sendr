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

export const EMAIL_STATUSES = ["sent", "delivered", "bounced", "complained", "failed"] as const
export type EmailStatus = (typeof EMAIL_STATUSES)[number]

/** A single email sent through the API, outside any campaign. */
export type Email = {
  id: string
  senderId: string | null
  to: string
  subject: string
  status: EmailStatus
  error: string | null
  createdAt: string
}

/**
 * How a campaign's body is written. "editor": the editor's HTML subset, which Sendr lays out
 * for email clients. "html": the sender's own HTML, sent as written. "text": plain text only.
 */
export const CAMPAIGN_FORMATS = ["editor", "html", "text"] as const
export type CampaignFormat = (typeof CAMPAIGN_FORMATS)[number]

/** The longest subject: RFC 5322 caps a header line at 998 characters. */
export const SUBJECT_MAX = 998

/** The most contacts a campaign's first batch can hold before it waits for approval. */
export const FIRST_BATCH_MAX = 100_000

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

/** What a recipient did with a campaign email, counted once per delivery. */
export type Engagement = "opened" | "clicked"

/** Deliveries per status, plus how many were opened and clicked. */
export type CampaignCounts = Record<DeliveryStatus | Engagement, number> & { total: number }

/** A link in a campaign and how many recipients clicked it. */
export type CampaignLink = { url: string; clicks: number }

export type Campaign = {
  id: string
  subject: string
  format: CampaignFormat
  body: string
  status: CampaignStatus
  senderId: string | null
  firstBatchSize: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  counts: CampaignCounts
}

export const MEDIA_KINDS = ["image", "video", "audio"] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

/** An uploaded file campaigns can show or link to. `url` is public and absolute, for emails. */
export type Media = {
  id: string
  kind: MediaKind
  name: string
  contentType: string
  size: number
  url: string
  /** A video's or audio's cover image. */
  posterUrl: string | null
  durationSeconds: number | null
  createdAt: string
}

/** Contacts one `POST /contacts/batch` call can add or update. */
export const CONTACTS_BATCH_LIMIT = 1000

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
  footer: string
  publicUrl: string
}

export const SENDER_PROVIDERS = ["ses"] as const
export type SenderProvider = (typeof SENDER_PROVIDERS)[number]

export type Sender = {
  id: string
  name: string
  email: string
  replyTo: string
  provider: SenderProvider
  region: string
  /** As of the last check: the provider lets this address send. */
  verified: boolean
  /** As of the last check: the provider account can email anyone, not just verified addresses. */
  production: boolean
  eventsConnected: boolean
  createdAt: string
}

/** A DNS record the sender's domain needs. "recommended" ones can't be checked by the provider. */
export type DnsRecord = {
  type: "CNAME" | "MX" | "TXT"
  name: string
  value: string
  status: "verified" | "pending" | "recommended"
}

/**
 * What an API key may do. An app's backend usually needs "contacts", "emails" or both; "full"
 * is everything the admin can do, for agents, and covers the other two.
 */
export const API_KEY_PERMISSIONS = ["contacts", "emails", "full"] as const
export type ApiKeyPermission = (typeof API_KEY_PERMISSIONS)[number]

export type ApiKey = {
  id: string
  name: string
  permissions: ApiKeyPermission[]
  prefix: string
  createdAt: string
  lastUsedAt: string | null
}

/** `"Acme, Inc." <hi@acme.com>`: quoted, because a comma in a bare name splits the address. */
export function senderAddress(sender: { name: string; email: string }) {
  if (!sender.name) return sender.email
  return `"${sender.name.replace(/["\\]/g, "\\$&")}" <${sender.email}>`
}
