import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { CAMPAIGN_STATUS } from "@/lib/campaign"
import type { CampaignStatus } from "../../shared/model"

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const meta = CAMPAIGN_STATUS[status]
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  )
}
