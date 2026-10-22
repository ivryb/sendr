import { data } from "react-router"

import type { Route } from "./+types/campaign"
import { refreshInterval } from "@/lib/campaign"
import { usePolling } from "@/lib/use-polling"
import { CampaignDetail } from "@/pages/campaign-detail"
import { CampaignEditor } from "@/pages/campaign-editor"
import { CampaignError, getCampaign } from "../../worker/domain/campaigns"
import { contactCounts } from "../../worker/domain/contacts"
import { listSenders } from "../../worker/domain/senders"
import { campaignLinks } from "../../worker/domain/tracking"
import { getSettings } from "../../worker/lib/settings"

export async function loader({ params }: Route.LoaderArgs) {
  const [campaign, links, settings, senders, counts] = await Promise.all([
    getCampaign(params.id).catch((error) => {
      if (error instanceof CampaignError && error.code === "not_found") {
        throw data(null, { status: 404 })
      }
      throw error
    }),
    campaignLinks(params.id),
    getSettings(),
    listSenders(),
    contactCounts(),
  ])
  return {
    campaign,
    links,
    senders,
    footer: settings.footer,
    subscribed: counts.subscribed,
  }
}

export default function CampaignPage({ loaderData }: Route.ComponentProps) {
  const { campaign, links, senders, footer, subscribed } = loaderData
  usePolling(refreshInterval(campaign))

  return campaign.status === "draft" ? (
    <CampaignEditor
      key={campaign.id}
      campaign={campaign}
      senders={senders}
      footer={footer}
      subscribed={subscribed}
    />
  ) : (
    <CampaignDetail
      campaign={campaign}
      links={links}
      sender={senders.find((sender) => sender.id === campaign.senderId) ?? null}
      footer={footer}
    />
  )
}
