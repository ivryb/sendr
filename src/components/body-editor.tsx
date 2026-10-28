import { lazy, Suspense, useState, useSyncExternalStore } from "react"
import { cn } from "cn"

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
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { CAMPAIGN_FORMATS, type CampaignFormat } from "../../shared/model"
import { bodyToText, editorBodyToHtml, markdownToHtml } from "../../shared/render"

// The server renders a stand-in, so the editor stays out of the Worker's bundle.
const RichEditor = import.meta.env.SSR
  ? () => null
  : lazy(() => import("@/components/editor/rich-editor"))

const LABELS: Record<CampaignFormat, string> = {
  editor: "Editor",
  html: "HTML",
  text: "Plain text",
}

type Message = { format: CampaignFormat; body: string }

/**
 * The campaign's message in its format, with a switch that converts it to another. A switch
 * that would lose something asks first.
 */
export function BodyEditor({
  subject,
  format,
  body,
  onChange,
  className,
}: {
  subject: string
  format: CampaignFormat
  body: string
  onChange: (message: Partial<Message>) => void
  /** Sizes the writing area. */
  className?: string
}) {
  const [pending, setPending] = useState<(Message & { loss: string }) | null>(null)
  const [converted, setConverted] = useState(false)
  const apply = (message: Message) => {
    setConverted(true)
    onChange(message)
  }
  const switchTo = (next: CampaignFormat) => {
    const message = convert({ format, body }, next, subject)
    if (message.loss && body.trim()) setPending({ ...message, loss: message.loss })
    else apply({ format: message.format, body: message.body })
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Tabs value={format} onValueChange={(next: CampaignFormat) => switchTo(next)}>
          <TabsList className="h-8">
            {CAMPAIGN_FORMATS.map((option) => (
              <TabsTrigger key={option} value={option} className="px-2.5 text-xs">
                {LABELS[option]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {format === "editor" && (
          <span className="text-xs text-muted-foreground max-sm:hidden">
            Drop images, GIFs, video or audio
          </span>
        )}
      </div>

      {format === "editor" ? (
        <LazyRichEditor
          body={body}
          converted={converted}
          onChange={(next) => onChange({ body: next })}
          className={className}
        />
      ) : (
        <Textarea
          value={body}
          onChange={(event) => onChange({ body: event.target.value })}
          placeholder={
            format === "html"
              ? "<!doctype html>\n<html>…</html>"
              : "Hi {{first_name|there}},"
          }
          aria-label="Message"
          spellCheck={format === "text"}
          className={cn(
            "min-h-80 resize-none rounded-xl bg-card px-4 py-3.5 shadow-xs lg:field-sizing-fixed",
            format === "html" ? "font-mono text-[13px]/relaxed" : "text-[15px]/relaxed",
            className
          )}
        />
      )}

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to {pending && LABELS[pending.format]}?</AlertDialogTitle>
            <AlertDialogDescription>{pending?.loss}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it as is</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) apply({ format: pending.format, body: pending.body })
                setPending(null)
              }}
            >
              Switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** `message` in another format, and what the switch loses, if anything. */
function convert(message: Message, format: CampaignFormat, subject: string) {
  const { body } = message
  const to = (next: string, loss: string | null = null) => ({ format, body: next, loss })
  if (format === message.format) return to(body)
  if (format === "text") {
    return to(
      bodyToText(message.format, body),
      "Plain text has no formatting, images or buttons: links become addresses in the text."
    )
  }
  const editorBody = message.format === "text" ? markdownToHtml(body) : body
  if (format === "html") return to(editorBodyToHtml(subject, editorBody))
  if (message.format === "text") return to(editorBody)
  return to(
    documentBody(body),
    "The editor keeps the text, headings, links and images. A custom layout is simplified."
  )
}

/**
 * What's inside a document's body, which the editor then reads as well as it can. Inline styles
 * go: in emails they're layout, and the editor would read some as formatting.
 */
function documentBody(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html")
  doc.querySelectorAll("style, script, [aria-hidden=true]").forEach((element) => element.remove())
  doc.querySelectorAll("[style]").forEach((element) => element.removeAttribute("style"))
  return doc.body.innerHTML
}

/** Loads the editor's chunk on the client only, with a calm stand-in until it's there. */
function LazyRichEditor(props: {
  body: string
  converted: boolean
  onChange: (body: string) => void
  className?: string
}) {
  const client = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )
  const fallback = <EditorSkeleton className={props.className} />
  if (!client) return fallback
  return (
    <Suspense fallback={fallback}>
      <RichEditor {...props} />
    </Suspense>
  )
}

function EditorSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl bg-white shadow-xs ring-1 ring-stone-200 dark:ring-white/10",
        className
      )}
    >
      <div className="h-10 border-b border-stone-100" />
      <div className="mx-auto flex w-full max-w-[552px] flex-col gap-3 px-5 py-6 sm:px-10 sm:py-8">
        <Skeleton className="h-6 w-2/5 bg-stone-100" />
        <Skeleton className="mt-2 h-4 w-full bg-stone-100" />
        <Skeleton className="h-4 w-11/12 bg-stone-100" />
        <Skeleton className="h-4 w-3/5 bg-stone-100" />
      </div>
    </div>
  )
}

function subscribeNever() {
  return () => {}
}
