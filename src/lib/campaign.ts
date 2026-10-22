import type {
  Campaign,
  CampaignCounts,
  CampaignStatus,
  DeliveryStatus,
} from "../../shared/model"

type StatusMeta = {
  label: string
  /** Tailwind classes for the status dot. */
  dot: string
  /** How often to refresh a campaign in this status, in ms. */
  refresh: number | false
}

export const CAMPAIGN_STATUS: Record<CampaignStatus, StatusMeta> = {
  draft: { label: "Draft", dot: "bg-muted-foreground/40", refresh: false },
  first_batch: {
    label: "First batch",
    dot: "bg-sky-500 animate-pulse",
    refresh: 3000,
  },
  // Bounce and complaint events keep arriving while the operator reviews.
  awaiting_approval: {
    label: "Needs review",
    dot: "bg-amber-500",
    refresh: 10_000,
  },
  sending: { label: "Sending", dot: "bg-sky-500 animate-pulse", refresh: 3000 },
  sent: { label: "Sent", dot: "bg-emerald-500", refresh: false },
  cancelled: {
    label: "Cancelled",
    dot: "bg-muted-foreground/40",
    refresh: false,
  },
}

/** How often to refresh a campaign, in ms. Delivery reports keep arriving after it finishes. */
export function refreshInterval({ status, counts }: Campaign) {
  return CAMPAIGN_STATUS[status].refresh || (counts.sent > 0 ? 30_000 : false)
}

/** The stages a started campaign moves through, in order. */
export const CAMPAIGN_STAGES = [
  { status: "first_batch", label: "First batch" },
  { status: "awaiting_approval", label: "Review" },
  { status: "sending", label: "Sending" },
  { status: "sent", label: "Sent" },
] as const satisfies { status: CampaignStatus; label: string }[]

export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Complained",
  failed: "Failed",
  skipped: "Skipped",
}

/** Above these first-batch rates, mailbox providers start treating the sender as a spammer. */
export const RATE_LIMITS: Partial<Record<DeliveryStatus, number>> &
  Record<"bounced" | "complained", number> = {
  bounced: 0.05,
  complained: 0.001,
}

/**
 * Opens or clicks as a share of delivered emails (complaints were delivered too). Null until
 * delivery reports arrive; capped at 100% because a report can lag behind an open.
 */
export function engagementRate(
  counts: CampaignCounts,
  kind: "opened" | "clicked"
) {
  const delivered = counts.delivered + counts.complained
  return delivered ? Math.min(counts[kind] / delivered, 1) : null
}

export function deliveryStats(counts: CampaignCounts) {
  // Delivered, bounced and complained are later outcomes of a sent message.
  const handedOff =
    counts.sent + counts.delivered + counts.bounced + counts.complained
  return {
    handedOff,
    processed: counts.total - counts.queued,
    rate: (status: DeliveryStatus) =>
      handedOff ? counts[status] / handedOff : 0,
  }
}
