import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  CheckIcon,
  EllipsisIcon,
  FlaskConicalIcon,
  SendIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { Link, useNavigate, useRevalidator } from "react-router"
import { toast } from "sonner"
import { cn } from "cn"

import { useAdmin } from "@/components/app-shell"
import { BackToCampaigns } from "@/components/back-link"
import { BodyEditor } from "@/components/body-editor"
import { senderLabel } from "@/components/senders"
import { EmailPreview } from "@/components/email-preview"
import { Button } from "@/components/ui/button"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api, ApiError } from "@/lib/api"
import { formatNumber, plural } from "@/lib/format"
import { useChange } from "@/lib/mutations"
import type { Campaign, Sender } from "../../shared/model"

type Draft = Pick<
  Campaign,
  "subject" | "format" | "body" | "firstBatchSize" | "senderId"
>

export function CampaignEditor({
  campaign,
  senders,
  footer,
  subscribed,
}: {
  campaign: Campaign
  senders: Sender[]
  footer: string
  subscribed: number
}) {
  const campaignSave = useAutosave(
    pickDraft(campaign),
    `/api/v1/campaigns/${campaign.id}`
  )
  // The footer is shared by every campaign, so it saves to the instance's settings.
  const footerSave = useAutosave({ footer }, "/api/v1/settings")
  const saves = [campaignSave, footerSave]
  const flush = async () => {
    await Promise.all(saves.map((save) => save.flush()))
  }
  const { value: draft, update } = campaignSave
  const sender = senders.find(({ id }) => id === draft.senderId) ?? null
  const [tab, setTab] = useState<"write" | "preview">("write")

  return (
    <div data-wide className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackToCampaigns />
        <div className="flex items-center gap-2">
          <SaveIndicator saves={saves} />
          <SendTestButton id={campaign.id} flush={flush} />
          <StartButton
            campaign={campaign}
            draft={draft}
            subscribed={subscribed}
            flush={flush}
          />
          <DraftMenu id={campaign.id} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <textarea
          value={draft.subject}
          onChange={(event) =>
            update({ subject: event.target.value.replace(/\n/g, " ") })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault()
          }}
          rows={1}
          placeholder="Subject"
          aria-label="Subject"
          maxLength={998}
          autoFocus={!campaign.subject}
          className="field-sizing-content w-full resize-none bg-transparent text-2xl font-semibold tracking-tight text-balance outline-none placeholder:text-muted-foreground/50 sm:text-3xl"
        />
        <div className="flex items-center gap-3 sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
          <SenderField
            senders={senders}
            value={draft.senderId}
            onChange={(senderId) => update({ senderId })}
          />
          <FirstBatchField
            value={draft.firstBatchSize}
            onChange={(firstBatchSize) => update({ firstBatchSize })}
          />
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value)}
        className="lg:hidden"
      >
        <TabsList className="w-full">
          <TabsTrigger value="write">Write</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div
          className={cn(
            "flex min-w-0 flex-col gap-2",
            tab !== "write" && "hidden lg:flex"
          )}
        >
          <BodyEditor
            subject={draft.subject}
            format={draft.format}
            body={draft.body}
            onChange={update}
            className="min-h-96 lg:h-[max(28rem,calc(100svh-19rem))]"
          />
          <div className="flex flex-col gap-1.5 pt-4">
            <label htmlFor="footer" className="text-sm font-medium">
              Footer
            </label>
            <Textarea
              id="footer"
              value={footerSave.value.footer}
              onChange={(event) =>
                footerSave.update({ footer: event.target.value })
              }
              placeholder={"Acme Inc.\n1 Main Street, Springfield, CA 90000"}
              className="min-h-20 resize-y rounded-xl bg-card px-4 py-3 font-mono text-[13px]/relaxed shadow-xs"
            />
            <p className="text-xs/relaxed text-muted-foreground">
              Shared by every campaign, above the unsubscribe link. Include your
              postal address: anti-spam laws require one.
            </p>
          </div>
        </div>
        {/* Level with the format switch, as tall as the writing area under it. */}
        <EmailPreview
          subject={draft.subject}
          format={draft.format}
          body={draft.body}
          from={sender}
          footer={footerSave.value.footer}
          grow
          className={cn(
            "max-lg:-mx-4 max-lg:rounded-none max-lg:ring-0 sm:max-lg:-mx-8 lg:sticky lg:top-6 lg:h-[max(30.75rem,calc(100svh-16.25rem))]",
            tab !== "preview" && "hidden lg:flex"
          )}
        />
      </div>
    </div>
  )
}

/**
 * Keeps a local copy of `initial` and PUTs it to `path` shortly after each change.
 * `flush` saves immediately, for actions that need the server copy to be current.
 */
function useAutosave<T extends Record<string, unknown>>(
  initial: T,
  path: string
) {
  const { revalidate } = useRevalidator()
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const save = useMutation({
    mutationFn: (next: T) => api(path, { method: "PUT", body: next }),
    onSuccess: (_, next) => setSaved(next),
    meta: { silent: true },
  })
  const dirty = !sameValues(value, saved)
  const { mutate, mutateAsync } = save
  // A refused save (say, the campaign was started elsewhere) waits for an edit or a retry
  // instead of repeating the same request.
  const refused = save.isError && save.variables && sameValues(save.variables, value)

  useEffect(() => {
    if (!dirty || save.isPending || refused) return
    const timer = setTimeout(() => mutate(value), 700)
    return () => clearTimeout(timer)
  }, [value, dirty, save.isPending, refused, mutate])

  // Leaving within the debounce window still keeps the last keystrokes.
  const pending = useRef<T | null>(null)
  useEffect(() => {
    pending.current = dirty ? value : null
  }, [value, dirty])
  useEffect(
    () => () => {
      const edits = pending.current
      if (!edits) return
      // The next page loaded before this save, so it reloads to show the edits.
      api(path, { method: "PUT", body: edits })
        .then(() => revalidate())
        .catch(() => {})
    },
    [path, revalidate]
  )

  return {
    value,
    update: (patch: Partial<T>) =>
      setValue((current) => ({ ...current, ...patch })),
    status:
      save.isPending || (dirty && !save.isError)
        ? ("saving" as const)
        : dirty
          ? ("error" as const)
          : ("saved" as const),
    error: save.error instanceof ApiError ? save.error.message : null,
    retry: () => mutate(value),
    flush: async () => {
      if (dirty) await mutateAsync(value)
    },
  }
}

function pickDraft({
  subject,
  format,
  body,
  firstBatchSize,
  senderId,
}: Campaign): Draft {
  return { subject, format, body, firstBatchSize, senderId }
}

function sameValues<T extends Record<string, unknown>>(a: T, b: T) {
  return Object.keys(a).every((key) => a[key] === b[key])
}

type Autosave = Pick<ReturnType<typeof useAutosave>, "status" | "error" | "retry">

function SaveIndicator({ saves }: { saves: Autosave[] }) {
  const failed = saves.filter((save) => save.status === "error")
  const status = failed.length
    ? "error"
    : saves.some((save) => save.status === "saving")
      ? "saving"
      : "saved"
  if (status === "error") {
    return (
      <button
        type="button"
        onClick={() => failed.forEach((save) => save.retry())}
        className="inline-flex items-center gap-1.5 px-1 text-xs text-destructive"
      >
        <TriangleAlertIcon className="size-3.5 shrink-0" />
        {failed[0].error ?? "Not saved."} Retry
      </button>
    )
  }
  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-1.5 px-1 text-xs text-muted-foreground"
    >
      {status === "saving" ? (
        <Spinner className="size-3.5" />
      ) : (
        <CheckIcon className="size-3.5" />
      )}
      <span className="sr-only sm:not-sr-only">
        {status === "saving" ? "Saving…" : "Saved"}
      </span>
    </span>
  )
}

function SenderField({
  senders,
  value,
  onChange,
}: {
  senders: Sender[]
  value: string | null
  onChange: (senderId: string | null) => void
}) {
  if (senders.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        From{" "}
        <Link
          to="/senders/new"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Add a sender
        </Link>
      </span>
    )
  }
  const items = senders.map((sender) => ({
    value: sender.id,
    label: senderLabel(sender),
  }))
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground max-sm:flex-1">
      <span className="max-sm:sr-only">From</span>
      <Select items={items} value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="min-w-0 text-foreground max-sm:flex-1">
          <SelectValue placeholder="Choose a sender" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function FirstBatchField({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  const valid = isBatchSize(Number(text))
  return (
    <label className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span className="sm:hidden">Batch</span>
      <span className="max-sm:hidden">First batch</span>
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={100_000}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          const next = Number(event.target.value)
          if (isBatchSize(next)) onChange(next)
        }}
        aria-invalid={!valid || undefined}
        className="h-7 w-20 [appearance:textfield] px-2 text-center tabular-nums [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="max-sm:hidden">
        contacts, then it pauses for your review
      </span>
    </label>
  )
}

function isBatchSize(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 100_000
}

function SendTestButton({
  id,
  flush,
}: {
  id: string
  flush: () => Promise<void>
}) {
  const me = useAdmin()
  const send = useMutation({
    mutationFn: async () => {
      await flush()
      await api(`/api/v1/campaigns/${id}/test`, { body: {} })
    },
    onSuccess: () => toast.success(`Test sent to ${me.email}`),
  })
  return (
    <Button
      variant="outline"
      onClick={() => send.mutate()}
      disabled={send.isPending}
    >
      {send.isPending ? <Spinner /> : <FlaskConicalIcon />}
      <span className="hidden sm:inline">Send test</span>
      <span className="sm:hidden">Test</span>
    </Button>
  )
}

function StartButton({
  campaign,
  draft,
  subscribed,
  flush,
}: {
  campaign: Campaign
  draft: Draft
  subscribed: number
  flush: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const start = useChange({
    mutationFn: async () => {
      await flush()
      return api<{ campaign: Campaign }>(
        `/api/v1/campaigns/${campaign.id}/start`,
        { body: {} }
      )
    },
    onSuccess: () => setOpen(false),
    meta: { silent: true },
  })
  const batch = draft.firstBatchSize
  const audience =
    subscribed === 0
      ? "You don't have any subscribed contacts yet. Connect your contacts first."
      : subscribed <= batch
        ? `Sendr sends it to all ${plural(subscribed, "subscribed contact")} at once. That fits in one batch, so there's no review pause.`
        : `Sendr sends it to the first ${formatNumber(batch)} of your ${plural(subscribed, "subscribed contact")}, then stops so you can check bounces and complaints. Everyone else gets it after you approve.`

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) start.reset()
      }}
    >
      <Button onClick={() => setOpen(true)}>
        <SendIcon />
        <span className="hidden sm:inline">Start sending</span>
        <span className="sm:hidden">Send</span>
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start sending?</AlertDialogTitle>
          <AlertDialogDescription>{audience}</AlertDialogDescription>
        </AlertDialogHeader>
        {start.error && (
          <p role="alert" className="text-sm text-destructive">
            {start.error.message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => start.mutate()}
            disabled={!subscribed || start.isPending}
          >
            {start.isPending && <Spinner />}
            {subscribed > batch
              ? `Send to first ${formatNumber(batch)}`
              : "Send now"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DraftMenu({ id }: { id: string }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await navigate("/campaigns")
      toast.success("Draft deleted")
    },
  })
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label="More" />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon />
            Delete draft
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The subject and message are gone for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {remove.isPending && <Spinner />}
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
