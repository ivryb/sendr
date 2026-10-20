import { data } from "react-router"

import type { Route } from "./+types/campaign"
import { refreshInterval } from "@/lib/campaign"
import { usePolling } from "@/lib/use-polling"
import { CampaignDetail } from "@/pages/campaign-detail"
import { CampaignEditor } from "@/pages/campaign-editor"
import { CampaignError, getCampaign } from "../../worker/domain/campaigns"
import { contactCounts } from "../../worker/domain/contacts"
import { getSettings } from "../../worker/lib/settings"

export async function loader({ params }: Route.LoaderArgs) {
  const [campaign, settings, counts] = await Promise.all([
    getCampaign(params.id).catch((error) => {
      if (error instanceof CampaignError && error.code === "not_found") {
        throw data(null, { status: 404 })
      }
      throw error
    }),
    getSettings(),
    contactCounts(),
  ])
  const { fromName, fromEmail, footer } = settings
  return {
    campaign,
    settings: { fromName, fromEmail, footer },
    subscribed: counts.subscribed ?? 0,
  }
}

export default function CampaignPage({ loaderData }: Route.ComponentProps) {
  const { campaign, settings, subscribed } = loaderData
  usePolling(refreshInterval(campaign))

  return campaign.status === "draft" ? (
    <CampaignEditor
      key={campaign.id}
      campaign={campaign}
      settings={settings}
      subscribed={subscribed}
    />
  ) : (
    <CampaignDetail campaign={campaign} settings={settings} />
  )
}
