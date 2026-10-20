import { useSuspenseQuery } from "@tanstack/react-query"
import { useParams } from "react-router"

import { queries } from "@/lib/api"
import { refreshInterval } from "@/lib/campaign"
import { CampaignDetail } from "@/pages/campaign-detail"
import { CampaignEditor } from "@/pages/campaign-editor"

export function CampaignPage() {
  const id = useParams().id!
  const campaign = useSuspenseQuery({
    ...queries.campaign(id),
    refetchInterval: (query) =>
      query.state.data ? refreshInterval(query.state.data) : false,
    refetchOnWindowFocus: true,
  }).data

  return campaign.status === "draft" ? (
    <CampaignEditor key={id} campaign={campaign} />
  ) : (
    <CampaignDetail campaign={campaign} />
  )
}
