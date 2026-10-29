import { useState } from "react"
import {
  CheckIcon,
  CircleAlertIcon,
  EyeIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react"
import { Link } from "react-router"
import { cn } from "cn"

import { BackToCampaigns } from "@/components/back-link"
import { EmailPreview } from "@/components/email-preview"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api"
import {
  DELIVERY_LABELS,
  RATE_LIMITS,
  deliveryStats,
  engagementRate,
} from "@/lib/campaign"
import { formatNumber, formatPercent, plural, useDates } from "@/lib/format"
import { useChange } from "@/lib/mutations"
import {
  CAMPAIGN_ACTIONS,
  type Campaign,
  type CampaignAction,
  type Engagement,
  type CampaignLink,
  type DeliveryStatus,
  type Sender,
} from "../../shared/model"

type RunAction = Exclude<CampaignAction, "start">

const ACTIONS: Record<
  RunAction,
  {
    label: string
    variant: "default" | "outline"
    title: string
    description: (campaign: Campaign) => string
    confirm: string
  }
> = {
  approve: {
    label: "Send to everyone else",
    variant: "default",
    title: "Send to everyone else?",
    description: (campaign) =>
      `Sendr sends it to the remaining ${plural(campaign.counts.queued, "contact")}. This can't be undone.`,
    confirm: "Send it",
  },
  cancel: {
    label: "Cancel campaign",
    variant: "outline",
    title: "Cancel this campaign?",
    description: () =>
      "Contacts who already got it keep it. Nobody else will get it, and you can't restart it.",
    confirm: "Cancel campaign",
  },
}

const ENGAGEMENT_LABELS: Record<Engagement, string> = {
  opened: "Opened",
  clicked: "Clicked",
}

const COUNT_CARDS: (DeliveryStatus | Engagement)[] = [
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "failed",
  "skipped",
  "queued",
]

export function CampaignDetail({
  campaign,
  links,
  sender,
  footer,
}: {
  campaign: Campaign
  links: CampaignLink[]
  sender: Sender | null
  footer: string
}) {
  const actions = CAMPAIGN_ACTIONS[campaign.status].filter(
    (action): action is RunAction => action !== "start"
  )
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <BackToCampaigns />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <ProgressRing campaign={campaign} />
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                {campaign.subject}
              </h1>
              <StatusLine campaign={campaign} />
            </div>
          </div>
          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.toReversed().map((action) => (
                <ActionButton
                  key={action}
                  action={action}
                  campaign={campaign}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {campaign.status === "awaiting_approval" && (
        <Review campaign={campaign} />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Deliveries</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COUNT_CARDS.map((name) => (
            <CountCard key={name} name={name} campaign={campaign} />
          ))}
        </div>
      </section>

      {links.length > 0 && <ClickedLinks links={links} />}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Message</h2>
        <EmailPreview
          subject={campaign.subject}
          format={campaign.format}
          body={campaign.body}
          from={sender}
          footer={footer}
          className="h-[36rem]"
        />
      </section>
    </div>
  )
}

/** How far the current stage is: the first batch until it's approved, then everyone. */
function stageProgress({ status, counts, firstBatchSize }: Campaign) {
  const { handedOff, processed } = deliveryStats(counts)
  const firstBatch = status === "first_batch" || status === "awaiting_approval"
  const size = firstBatch
    ? Math.min(firstBatchSize, counts.total)
    : counts.total
  return { sent: handedOff, size, done: size ? processed / size : 0 }
}

const RING_TONES = {
  live: "text-foreground",
  attention: "text-amber-500",
  sent: "text-emerald-500",
  cancelled: "text-muted-foreground/60",
}

function ringTone({ status, stalled }: Campaign): keyof typeof RING_TONES {
  if (stalled || status === "awaiting_approval") return "attention"
  if (status === "sent" || status === "cancelled") return status
  return "live"
}

const RING_RADIUS = 32
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

function ProgressRing({ campaign }: { campaign: Campaign }) {
  const { status } = campaign
  const done = status === "sent" ? 1 : stageProgress(campaign).done
  return (
    <div
      aria-hidden
      className={cn(
        "relative grid size-14 shrink-0 place-items-center sm:size-18",
        RING_TONES[ringTone(campaign)]
      )}
    >
      <svg viewBox="0 0 72 72" className="absolute inset-0 -rotate-90">
        <circle
          cx="36"
          cy="36"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth="7"
        />
        <circle
          cx="36"
          cy="36"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${done * RING_LENGTH} ${RING_LENGTH}`}
          className="transition-[stroke-dasharray] duration-500"
        />
      </svg>
      {status === "awaiting_approval" ? (
        <EyeIcon className="size-5" />
      ) : status === "sent" ? (
        <CheckIcon className="size-6" strokeWidth={3} />
      ) : status === "cancelled" ? (
        <XIcon className="size-5" />
      ) : (
        <span className="text-xs font-semibold tabular-nums sm:text-sm">
          {Math.floor(done * 100)}%
        </span>
      )}
    </div>
  )
}

function StatusLine({ campaign }: { campaign: Campaign }) {
  const { formatDateTime } = useDates()
  const { status, counts, stalled, progressAt, finishedAt } = campaign
  const { sent, size } = stageProgress(campaign)
  const progress = `${formatNumber(sent)} of ${formatNumber(size)} sent`
  const text =
    stalled && progressAt
      ? `No progress since ${formatDateTime(progressAt)} · ${progress}`
      : {
          draft: null,
          first_batch: `Sending the first batch · ${progress}`,
          awaiting_approval: `The first ${formatNumber(sent)} went out. Check how they landed, then send to the other ${formatNumber(counts.queued)}.`,
          sending: `Sending to everyone · ${progress}`,
          sent: `Sent to ${plural(sent, "contact")}${finishedAt ? ` · ${formatDateTime(finishedAt)}` : ""}`,
          cancelled: `Cancelled after ${progress}. The other ${formatNumber(counts.queued)} won't get it.`,
        }[status]
  return (
    <p
      className={cn(
        "text-sm text-muted-foreground tabular-nums",
        stalled && "text-amber-600 dark:text-amber-400"
      )}
    >
      {text}
    </p>
  )
}

function Review({ campaign }: { campaign: Campaign }) {
  const { counts } = campaign
  const stats = deliveryStats(counts)
  const rates = [
    { status: "bounced", label: "Bounce rate" },
    { status: "complained", label: "Complaint rate" },
  ] as const
  const tooHigh = rates.some(
    ({ status }) => stats.rate(status) > RATE_LIMITS[status]
  )
  const reported = counts.delivered + counts.bounced + counts.complained

  return (
    <section
      className={cn(
        "flex flex-col gap-5 rounded-xl p-5 ring-1 sm:p-6",
        tooHigh
          ? "bg-amber-500/5 ring-amber-500/30"
          : "bg-card ring-foreground/10"
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">Check the first batch</h2>
        <p className="max-w-prose text-sm/relaxed text-muted-foreground">
          {reported === 0
            ? "Delivery reports usually arrive within a few minutes. If none show up, check that the sender's delivery reports are connected."
            : tooHigh
              ? "Too many messages are bouncing or being marked as spam. Cancel this campaign and clean up your list before sending more: high rates can get your Amazon SES account paused."
              : `This looks healthy. Below ${formatPercent(RATE_LIMITS.bounced)} bounces and ${formatPercent(RATE_LIMITS.complained)} complaints, it's safe to send to everyone else.`}
        </p>
        {reported === 0 && (
          <Link
            to={
              campaign.senderId ? `/senders/${campaign.senderId}` : "/senders"
            }
            className="w-fit text-sm font-medium underline underline-offset-4"
          >
            Check the sender
          </Link>
        )}
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {rates.map(({ status, label }) => {
          const rate = stats.rate(status)
          const high = rate > RATE_LIMITS[status]
          return (
            <div
              key={status}
              className="flex items-center justify-between gap-4 rounded-lg bg-background px-4 py-3 ring-1 ring-foreground/10"
            >
              <div className="flex flex-col">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd
                  className={cn(
                    "text-xl font-semibold tabular-nums",
                    high && "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {formatPercent(rate)}
                </dd>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs",
                  high
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-muted-foreground"
                )}
              >
                {high ? (
                  <CircleAlertIcon className="size-3.5" />
                ) : (
                  <ShieldCheckIcon className="size-3.5" />
                )}
                Keep under {formatPercent(RATE_LIMITS[status])}
              </span>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

/** A count with its rate: bounces and complaints of sent emails, opens and clicks of delivered. */
function countStats(name: DeliveryStatus | Engagement, campaign: Campaign) {
  const { counts } = campaign
  if (name === "opened" || name === "clicked") {
    return {
      label: ENGAGEMENT_LABELS[name],
      rate: engagementRate(counts, name),
      high: false,
    }
  }
  const limit = RATE_LIMITS[name]
  const rate = deliveryStats(counts).rate(name)
  return {
    // A cancelled campaign's queued contacts will never get it.
    label:
      name === "queued" && campaign.status === "cancelled"
        ? "Not sent"
        : DELIVERY_LABELS[name],
    rate: limit === undefined ? null : rate,
    high: limit !== undefined && rate > limit,
  }
}

function CountCard({
  name,
  campaign,
}: {
  name: DeliveryStatus | Engagement
  campaign: Campaign
}) {
  const count = campaign.counts[name]
  const { label, rate, high } = countStats(name, campaign)
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-card px-4 py-3.5 ring-1 ring-foreground/10">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-2">
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums",
            count === 0 && "text-muted-foreground/60",
            high && "text-amber-600 dark:text-amber-400"
          )}
        >
          {formatNumber(count)}
        </span>
        {rate !== null && count > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatPercent(rate)}
          </span>
        )}
      </span>
    </div>
  )
}

function ClickedLinks({ links }: { links: CampaignLink[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Links</h2>
      <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
        {links.map((link) => (
          <li
            key={link.url}
            className="flex items-center gap-4 px-4 py-3 text-sm"
          >
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              title={link.url}
              className="min-w-0 flex-1 truncate underline-offset-4 hover:underline"
            >
              {link.url.replace(/^https?:\/\/(www\.)?/, "")}
            </a>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {plural(link.clicks, "click")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ActionButton({
  action,
  campaign,
}: {
  action: RunAction
  campaign: Campaign
}) {
  const config = ACTIONS[action]
  const [open, setOpen] = useState(false)
  const run = useChange({
    mutationFn: () =>
      api<{ campaign: Campaign }>(
        `/api/v1/campaigns/${campaign.id}/${action}`,
        { body: {} }
      ),
    onSuccess: () => setOpen(false),
  })
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button variant={config.variant} onClick={() => setOpen(true)}>
        {config.label}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{config.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {config.description(campaign)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction
            variant={action === "cancel" ? "destructive" : "default"}
            onClick={() => run.mutate()}
            disabled={run.isPending}
          >
            {run.isPending && <Spinner />}
            {config.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
