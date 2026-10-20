import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  EllipsisIcon,
  FlaskConicalIcon,
  SendIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { cn } from "cn"

import { BackToCampaigns } from "@/components/back-link"
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
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api, contactCounts, queries } from "@/lib/api"
import { formatNumber, plural } from "@/lib/format"
import type { Campaign } from "../../shared/model"

type Draft = Pick<Campaign, "subject" | "markdown" | "firstBatchSize">

const MERGE_TAGS = ["{{first_name|there}}", "{{fields.name|fallback}}"]

export function CampaignEditor({ campaign }: { campaign: Campaign }) {
  const autosave = useAutosave(campaign)
  const { draft, update } = autosave
  const [tab, setTab] = useState<"write" | "preview">("write")
  const body = useRef<HTMLTextAreaElement>(null)

  const insertTag = (tag: string) => {
    const textarea = body.current!
    textarea.focus()
    textarea.setRangeText(
      tag,
      textarea.selectionStart,
      textarea.selectionEnd,
      "end"
    )
    update({ markdown: textarea.value })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackToCampaigns />
        <div className="flex items-center gap-2">
          <SaveIndicator autosave={autosave} />
          <SendTestButton id={campaign.id} flush={autosave.flush} />
          <StartButton
            campaign={campaign}
            draft={draft}
            flush={autosave.flush}
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
        <FirstBatchField
          value={draft.firstBatchSize}
          onChange={(firstBatchSize) => update({ firstBatchSize })}
        />
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

      <div className="grid gap-6 lg:grid-cols-2">
        <div
          className={cn(
            "flex flex-col gap-2",
            tab !== "write" && "hidden lg:flex"
          )}
        >
          <Textarea
            ref={body}
            value={draft.markdown}
            onChange={(event) => update({ markdown: event.target.value })}
            placeholder={
              "Hi {{first_name|there}},\n\nWrite your update in Markdown."
            }
            aria-label="Message"
            spellCheck
            className="h-[max(26rem,calc(100svh-22rem))] resize-none rounded-xl bg-card px-4 py-3.5 font-mono text-[13.5px]/relaxed shadow-xs"
          />
          <p className="text-xs/relaxed text-muted-foreground">
            Markdown works. Personalize with{" "}
            {MERGE_TAGS.map((tag, index) => (
              <span key={tag}>
                {index > 0 && " or "}
                <button
                  type="button"
                  onClick={() => insertTag(tag)}
                  className="rounded bg-muted px-1 py-0.5 font-mono text-foreground transition-colors hover:bg-accent"
                  title="Insert at cursor"
                >
                  {tag}
                </button>
              </span>
            ))}
            . The text after the bar shows when a contact has no value.
          </p>
        </div>
        <EmailPreview
          subject={draft.subject}
          markdown={draft.markdown}
          className={cn(
            "h-[max(26rem,calc(100svh-22rem))]",
            tab !== "preview" && "hidden lg:flex"
          )}
        />
      </div>
    </div>
  )
}

/**
 * Keeps a local copy of the draft and saves it shortly after each change.
 * `flush` saves immediately, for actions that need the server copy to be current.
 */
function useAutosave(campaign: Campaign) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => pickDraft(campaign))
  const [saved, setSaved] = useState<Draft>(draft)
  const path = `/api/admin/campaigns/${campaign.id}`
  const save = useMutation({
    mutationFn: (values: Draft) =>
      api<{ campaign: Campaign }>(path, { method: "PUT", body: values }),
    onSuccess: (result, values) => {
      setSaved(values)
      queryClient.setQueryData(
        queries.campaign(campaign.id).queryKey,
        result.campaign
      )
    },
    meta: { silent: true },
  })
  const dirty = !sameDraft(draft, saved)
  const { mutate, mutateAsync } = save

  useEffect(() => {
    if (!dirty || save.isPending) return
    const timer = setTimeout(() => mutate(draft), 700)
    return () => clearTimeout(timer)
  }, [draft, dirty, save.isPending, mutate])

  // Leaving within the debounce window still keeps the last keystrokes.
  const pending = useRef<Draft | null>(null)
  useEffect(() => {
    pending.current = dirty ? draft : null
  }, [draft, dirty])
  useEffect(
    () => () => {
      const edits = pending.current
      if (!edits) return
      // Reopening the editor reads the cache, so it must hold the last keystrokes too.
      queryClient.setQueryData(
        queries.campaign(campaign.id).queryKey,
        (cached) => cached && { ...cached, ...edits }
      )
      api(path, { method: "PUT", body: edits })
        .then(() =>
          queryClient.invalidateQueries({
            queryKey: queries.campaigns.queryKey,
          })
        )
        .catch(() => {})
    },
    [path, campaign.id, queryClient]
  )

  return {
    draft,
    update: (patch: Partial<Draft>) =>
      setDraft((current) => ({ ...current, ...patch })),
    status:
      save.isPending || (dirty && !save.isError)
        ? ("saving" as const)
        : dirty
          ? ("error" as const)
          : ("saved" as const),
    retry: () => mutate(draft),
    flush: async () => {
      if (dirty) await mutateAsync(draft)
    },
  }
}

function pickDraft({ subject, markdown, firstBatchSize }: Campaign): Draft {
  return { subject, markdown, firstBatchSize }
}

function sameDraft(a: Draft, b: Draft) {
  return (
    a.subject === b.subject &&
    a.markdown === b.markdown &&
    a.firstBatchSize === b.firstBatchSize
  )
}

type Autosave = ReturnType<typeof useAutosave>

function SaveIndicator({ autosave }: { autosave: Autosave }) {
  if (autosave.status === "error") {
    return (
      <button
        type="button"
        onClick={autosave.retry}
        className="inline-flex items-center gap-1.5 px-1 text-xs text-destructive"
      >
        <TriangleAlertIcon className="size-3.5" />
        Not saved. Retry
      </button>
    )
  }
  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-1.5 px-1 text-xs text-muted-foreground"
    >
      {autosave.status === "saving" ? (
        <Spinner className="size-3.5" />
      ) : (
        <CheckIcon className="size-3.5" />
      )}
      <span className="sr-only sm:not-sr-only">
        {autosave.status === "saving" ? "Saving…" : "Saved"}
      </span>
    </span>
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
    <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      First batch
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
      <span>
        contacts
        <span className="hidden sm:inline">
          , then it pauses for your review
        </span>
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
  const me = useQuery(queries.me).data
  const send = useMutation({
    mutationFn: async () => {
      await flush()
      await api(`/api/admin/campaigns/${id}/test`, { body: {} })
    },
    onSuccess: () => toast.success(`Test sent to ${me?.email}`),
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
  flush,
}: {
  campaign: Campaign
  draft: Draft
  flush: () => Promise<void>
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const subscribed = useQuery({ ...contactCounts, enabled: open }).data?.counts
    .subscribed
  const start = useMutation({
    mutationFn: async () => {
      await flush()
      return api<{ campaign: Campaign }>(
        `/api/admin/campaigns/${campaign.id}/start`,
        { body: {} }
      )
    },
    onSuccess: (result) => {
      setOpen(false)
      queryClient.setQueryData(
        queries.campaign(campaign.id).queryKey,
        result.campaign
      )
      queryClient.invalidateQueries({ queryKey: queries.campaigns.queryKey })
    },
    meta: { silent: true },
  })
  const batch = draft.firstBatchSize
  const audience =
    subscribed === undefined
      ? null
      : subscribed === 0
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
          <AlertDialogDescription>
            {audience ?? <Spinner className="mx-auto" />}
          </AlertDialogDescription>
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
            {subscribed && subscribed > batch
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
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const remove = useMutation({
    mutationFn: () => api(`/api/admin/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      // The list loader serves the cache, so drop the draft from it before going there.
      queryClient.setQueryData(queries.campaigns.queryKey, (campaigns) =>
        campaigns?.filter((campaign) => campaign.id !== id)
      )
      await navigate("/campaigns")
      queryClient.removeQueries({ queryKey: queries.campaign(id).queryKey })
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
