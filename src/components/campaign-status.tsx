import { cn } from "cn"

import { statusMeta } from "@/lib/campaign"
import type { Campaign } from "../../shared/model"

export function CampaignStatusBadge({ campaign }: { campaign: Campaign }) {
  const { label, dot, tint } = statusMeta(campaign)
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tint
      )}
    >
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </span>
  )
}
