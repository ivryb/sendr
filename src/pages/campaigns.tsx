import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckIcon, PlusIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"
import { cn } from "cn"

import { CampaignStatusBadge } from "@/components/campaign-status"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { api, contactCounts, queries } from "@/lib/api"
import { CAMPAIGN_STATUS, deliveryStats } from "@/lib/campaign"
import { formatDate, formatNumber } from "@/lib/format"
import type { Campaign } from "../../shared/model"

export function CampaignsPage() {
  const campaigns = useQuery({
    ...queries.campaigns,
    refetchInterval: (query) =>
      query.state.data?.some(
        (campaign) => CAMPAIGN_STATUS[campaign.status].refresh
      )
        ? 5000
        : false,
  })
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
      {campaigns.isPending ? (
        <ListSkeleton />
      ) : campaigns.data?.length ? (
        <ul className="divide-y overflow-hidden rounded-xl ring-1 ring-foreground/10">
          {campaigns.data.map((campaign) => (
            <CampaignRow key={campaign.id} campaign={campaign} />
          ))}
        </ul>
      ) : (
        <GettingStarted onCreate={() => create.mutate()} />
      )}
    </div>
  )
}

function useCreateCampaign() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api<{ campaign: Campaign }>("/api/admin/campaigns", { body: {} }),
    onSuccess: ({ campaign }) => {
      queryClient.setQueryData(queries.campaign(campaign.id).queryKey, campaign)
      queryClient.invalidateQueries({ queryKey: queries.campaigns.queryKey })
      navigate(`/campaigns/${campaign.id}`)
    },
  })
}

function CampaignRow({ campaign }: { campaign: Campaign }) {
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
        <CampaignStatusBadge status={campaign.status} />
      </Link>
    </li>
  )
}

const STEP_ACTION =
  "w-fit text-sm font-medium underline underline-offset-4 hover:text-muted-foreground"

function GettingStarted({ onCreate }: { onCreate: () => void }) {
  const settings = useQuery(queries.settings).data
  const counts = useQuery(contactCounts).data?.counts
  const steps = [
    {
      done: Boolean(settings?.fromEmail),
      title: "Add a sender",
      body: "Choose the name and address your emails come from, and your postal address for the footer.",
      action: (
        <Link to="/settings" className={STEP_ACTION}>
          Open Settings
        </Link>
      ),
    },
    {
      done: Boolean(counts && Object.values(counts).some(Boolean)),
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
      body: "Write in Markdown and watch the real email take shape beside it.",
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

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-xl ring-1 ring-foreground/10">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex flex-col gap-2 bg-card px-5 py-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      ))}
    </div>
  )
}
