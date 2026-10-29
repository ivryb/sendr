import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { statusMeta } from "@/lib/campaign"
import type { Campaign } from "../../shared/model"

export function CampaignStatusBadge({ campaign }: { campaign: Campaign }) {
  const { label, dot } = statusMeta(campaign)
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </Badge>
  )
}
