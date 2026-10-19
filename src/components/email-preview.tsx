import { useMemo, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"
import { cn } from "cn"

import { queries } from "@/lib/api"
import { useDebounced } from "@/lib/use-debounced"
import { senderAddress } from "../../shared/model"
import { renderEmail } from "../../shared/render"

/**
 * The campaign as a recipient sees it, rendered by the same code the Worker sends with.
 * The signed-in admin stands in as the recipient.
 */
export function EmailPreview({
  subject,
  markdown,
  className,
}: {
  subject: string
  markdown: string
  className?: string
}) {
  const settings = useQuery(queries.settings).data
  const me = useQuery(queries.me).data
  const debouncedSubject = useDebounced(subject)
  const debouncedMarkdown = useDebounced(markdown)
  const email = useMemo(
    () =>
      renderEmail({
        subject: debouncedSubject,
        markdown: debouncedMarkdown,
        footer: settings?.footer ?? "",
        recipient: { firstName: me?.name.split(" ")[0] ?? null, fields: {} },
        unsubscribeUrl: "#",
      }),
    [debouncedSubject, debouncedMarkdown, settings?.footer, me?.name]
  )
  const from = settings?.fromEmail ? senderAddress(settings) : null
  // A new srcDoc reloads the frame at the top; keep the reader where they were.
  const frame = useRef<HTMLIFrameElement>(null)
  const scrollY = useRef(0)

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-xs ring-1 ring-foreground/10",
        className
      )}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b border-stone-200 bg-stone-50 px-4 py-3 text-[13px] text-stone-500">
        <dt>From</dt>
        <dd className="truncate text-stone-900">
          {from ?? (
            <Link to="/settings" className="text-amber-700 underline">
              Add a sender in Settings
            </Link>
          )}
        </dd>
        <dt>Subject</dt>
        <dd className="truncate font-medium text-stone-900">
          {email.subject || (
            <span className="font-normal text-stone-400">No subject yet</span>
          )}
        </dd>
      </dl>
      <iframe
        title="Email preview"
        ref={frame}
        sandbox="allow-same-origin"
        srcDoc={email.html}
        onLoad={() => {
          const view = frame.current?.contentWindow
          if (!view) return
          view.scrollTo(0, scrollY.current)
          view.addEventListener("scroll", () => {
            scrollY.current = view.scrollY
          })
        }}
        className="min-h-0 w-full flex-1 bg-white"
      />
    </div>
  )
}
