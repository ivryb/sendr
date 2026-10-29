import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { CAMPAIGN_STATUS } from "@/lib/campaign"
import type { Campaign } from "../../shared/model"

export function CampaignStatusBadge({ campaign }: { campaign: Campaign }) {
  const meta = CAMPAIGN_STATUS[campaign.status]
  // A stalled send stops pulsing, so it doesn't pass for a live one.
  const dot = campaign.stalled ? "bg-amber-500" : meta.dot
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {meta.label}
    </Badge>
  )
}
