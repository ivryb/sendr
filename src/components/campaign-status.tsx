import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { CAMPAIGN_STATUS, useStalled } from "@/lib/campaign"
import type { Campaign } from "../../shared/model"

export function CampaignStatusBadge({ campaign }: { campaign: Campaign }) {
  const meta = CAMPAIGN_STATUS[campaign.status]
  // A stalled send stops pulsing, so it doesn't pass for a live one.
  const stalled = useStalled(campaign)
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", stalled ? "bg-amber-500" : meta.dot)} />
      {meta.label}
    </Badge>
  )
}
