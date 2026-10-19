import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { queries } from "@/lib/api"
import { CAMPAIGN_STATUS } from "@/lib/campaign"
import { CampaignDetail } from "@/pages/campaign-detail"
import { CampaignEditor } from "@/pages/campaign-editor"

export function CampaignPage() {
  const id = useParams().id!
  const campaign = useQuery({
    ...queries.campaign(id),
    refetchInterval: (query) =>
      query.state.data
        ? CAMPAIGN_STATUS[query.state.data.status].refresh
        : false,
  })

  if (campaign.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }
  if (!campaign.data) {
    return (
      <div className="flex flex-col items-start gap-4 py-16">
        <h1 className="text-xl font-semibold">This campaign isn't here</h1>
        <p className="text-sm text-muted-foreground">
          It may have been a draft that someone deleted.
        </p>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/campaigns" />}
        >
          Back to campaigns
        </Button>
      </div>
    )
  }
  return campaign.data.status === "draft" ? (
    <CampaignEditor key={id} campaign={campaign.data} />
  ) : (
    <CampaignDetail campaign={campaign.data} />
  )
}
