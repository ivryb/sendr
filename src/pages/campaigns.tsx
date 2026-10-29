import { useMutation } from "@tanstack/react-query"
import { CheckIcon, PlusIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"
import { cn } from "cn"

import type { Route } from "./+types/campaigns"
import { CampaignStatusBadge } from "@/components/campaign-status"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api"
import { deliveryStats, refreshInterval } from "@/lib/campaign"
import { formatNumber, useDates } from "@/lib/format"
import { usePolling } from "@/lib/use-polling"
import type { Campaign } from "../../shared/model"
import { listCampaigns } from "../../worker/domain/campaigns"
import { contactCounts } from "../../worker/domain/contacts"
import { listSenders } from "../../worker/domain/senders"

export async function loader() {
  const [campaigns, senders] = await Promise.all([listCampaigns(), listSenders()])
  // Only the getting-started steps need it, and counting reads every contact on each refresh.
  const hasContacts =
    campaigns.length === 0 && Object.values(await contactCounts()).some(Boolean)
  return {
    campaigns,
    hasSender: senders.some((sender) => sender.verified),
    hasContacts,
  }
}

export default function CampaignsPage({ loaderData }: Route.ComponentProps) {
  const { campaigns, hasSender, hasContacts } = loaderData
  // A refresh counts every campaign's deliveries.
  const deliveries = campaigns.reduce((sum, campaign) => sum + campaign.counts.total, 0)
  const intervals = campaigns
    .map((campaign) => refreshInterval(campaign, deliveries))
    .filter((interval) => interval !== false)
  usePolling(intervals.length ? Math.min(...intervals) : false)
  const create = useCreateCampaign()

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Campaigns"
        description="Each campaign goes to a small first batch, then waits for your review."
        actions={
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <PlusIcon />}
            New campaign
          </Button>
        }
      />
      {campaigns.length ? (
        <ul className="divide-y overflow-hidden rounded-xl ring-1 ring-foreground/10">
          {campaigns.map((campaign) => (
            <CampaignRow key={campaign.id} campaign={campaign} />
          ))}
        </ul>
      ) : (
        <GettingStarted
          hasSender={hasSender}
          hasContacts={hasContacts}
          onCreate={() => create.mutate()}
        />
      )}
    </div>
  )
}

function useCreateCampaign() {
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () =>
      api<{ campaign: Campaign }>("/api/v1/campaigns", { body: {} }),
    onSuccess: ({ campaign }) => navigate(`/campaigns/${campaign.id}`),
  })
}

function CampaignRow({ campaign }: { campaign: Campaign }) {
  const { formatDate } = useDates()
  const { handedOff } = deliveryStats(campaign.counts)
  const date = campaign.finishedAt ?? campaign.startedAt ?? campaign.createdAt
  const dateLabel = campaign.finishedAt
    ? "Finished"
    : campaign.startedAt
      ? "Started"
      : "Created"
  return (
    <li>
      <Link
        to={`/campaigns/${campaign.id}`}
        className="flex items-center gap-4 bg-card px-4 py-3.5 transition-colors hover:bg-muted/50 sm:px-5"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={cn(
              "truncate font-medium",
              !campaign.subject && "text-muted-foreground"
            )}
          >
            {campaign.subject || "Untitled"}
          </span>
          <span className="text-xs text-muted-foreground">
            {dateLabel} {formatDate(date)}
            {campaign.counts.total > 0 &&
              `, ${formatNumber(handedOff)} of ${formatNumber(campaign.counts.total)} sent`}
          </span>
        </div>
        <CampaignStatusBadge campaign={campaign} />
      </Link>
    </li>
  )
}

const STEP_ACTION =
  "w-fit text-sm font-medium underline underline-offset-4 hover:text-muted-foreground"

function GettingStarted({
  hasSender,
  hasContacts,
  onCreate,
}: {
  hasSender: boolean
  hasContacts: boolean
  onCreate: () => void
}) {
  const steps = [
    {
      done: hasSender,
      title: "Add a sender",
      body: "Connect Amazon SES and verify the domain your emails come from.",
      action: (
        <Link to="/senders" className={STEP_ACTION}>
          Open Senders
        </Link>
      ),
    },
    {
      done: hasContacts,
      title: "Connect your contacts",
      body: "Create an API key and sync your users from your app.",
      action: (
        <Link to="/contacts" className={STEP_ACTION}>
          See how
        </Link>
      ),
    },
    {
      done: false,
      title: "Write your first campaign",
      body: "Write in the editor and watch the real email take shape beside it.",
      action: (
        <button type="button" onClick={onCreate} className={STEP_ACTION}>
          New campaign
        </button>
      ),
    },
  ]
  return (
    <section className="flex flex-col gap-6 rounded-xl border border-dashed px-5 py-8 sm:px-10 sm:py-10">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Send your first campaign</h2>
        <p className="text-sm text-muted-foreground">
          Three steps, and you only do the first two once.
        </p>
      </div>
      <ol className="flex flex-col gap-5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-medium tabular-nums",
                step.done &&
                  "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              )}
            >
              {step.done ? <CheckIcon className="size-3.5" /> : index + 1}
            </span>
            <div className="flex flex-col gap-1 pt-0.5">
              <span
                className={cn(
                  "font-medium",
                  step.done &&
                    "text-muted-foreground line-through decoration-muted-foreground/40"
                )}
              >
                {step.title}
              </span>
              <p className="max-w-prose text-sm text-muted-foreground">
                {step.body}
              </p>
              {!step.done && step.action}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
