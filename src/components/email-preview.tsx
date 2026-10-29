import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { ChevronLeftIcon, MoonIcon, SunIcon } from "lucide-react"
import { Link } from "react-router"
import { cn } from "cn"

import { useAdmin } from "@/components/app-shell"
import { useClientValue } from "@/lib/use-client-value"
import { useDebounced } from "@/lib/use-debounced"
import type { CampaignFormat } from "../../shared/model"
import {
  FONT,
  PALETTE,
  renderEmail,
  sampleRecipient,
  withScheme,
  type Scheme,
} from "../../shared/render"

/**
 * The campaign as a recipient sees it in a mail client, rendered by the same code the Worker
 * sends with. The signed-in admin stands in as the recipient. With `grow`, phones get the whole
 * email at full height and the page scrolls, instead of a frame that scrolls inside the page.
 */
export function EmailPreview({
  subject,
  format,
  body,
  from,
  footer,
  grow = false,
  className,
}: {
  subject: string
  format: CampaignFormat
  body: string
  from: { name: string; email: string } | null
  footer: string
  grow?: boolean
  className?: string
}) {
  const me = useAdmin()
  const debouncedSubject = useDebounced(subject)
  // Together, so a format switch doesn't render the old body in the new format.
  const message = useDebounced(useMemo(() => ({ format, body }), [format, body]))
  const debouncedFooter = useDebounced(footer)
  const email = useMemo(
    () =>
      renderEmail(
        { subject: debouncedSubject, ...message },
        { footer: debouncedFooter, recipient: sampleRecipient(me.name), unsubscribeUrl: "#" }
      ),
    [debouncedSubject, message, debouncedFooter, me.name]
  )
  const [scheme, setScheme] = usePreviewScheme()
  const dark = scheme === "dark"

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl shadow-xs ring-1 transition-colors",
        dark
          ? "bg-stone-900 text-stone-100 ring-stone-800"
          : "bg-white text-stone-900 ring-stone-200 dark:ring-white/10",
        className
      )}
    >
      <div
        className={cn(
          "flex h-11 shrink-0 items-center justify-between border-b px-4 lg:grid lg:grid-cols-[1fr_auto_1fr]",
          dark ? "border-stone-800 bg-stone-950" : "border-stone-200 bg-stone-100"
        )}
      >
        <div className="flex gap-1.5 max-lg:hidden" aria-hidden>
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
        <span
          className={cn(
            "inline-flex items-center text-[15px] font-medium lg:hidden",
            dark ? "text-blue-400" : "text-blue-600"
          )}
          aria-hidden
        >
          <ChevronLeftIcon className="-ml-1.5 size-5" />
          Inbox
        </span>
        <span
          className={cn("text-xs max-lg:hidden", dark ? "text-stone-400" : "text-stone-500")}
        >
          Inbox
        </span>
        <SchemeToggle value={scheme} onChange={setScheme} />
      </div>
      <MessageHeader subject={email.subject} from={from} dark={dark} />
      {email.html === null ? (
        <pre
          className="min-h-0 flex-1 overflow-auto px-6 py-5 text-base/relaxed whitespace-pre-wrap"
          style={{
            fontFamily: FONT,
            backgroundColor: PALETTE[scheme].bg,
            color: PALETTE[scheme].text,
          }}
        >
          {email.text}
        </pre>
      ) : (
        <EmailFrame html={email.html} scheme={scheme} grow={grow} />
      )}
    </div>
  )
}

function MessageHeader({
  subject,
  from,
  dark,
}: {
  subject: string
  from: { name: string; email: string } | null
  dark: boolean
}) {
  const time = useClientValue(() =>
    new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  )
  const muted = dark ? "text-stone-400" : "text-stone-500"
  return (
    <div
      className={cn(
        "shrink-0 border-b px-4 pt-5 pb-4 lg:px-6",
        dark ? "border-stone-800" : "border-stone-100"
      )}
    >
      <p className="truncate text-lg font-semibold tracking-tight">
        {subject || <span className={muted}>No subject yet</span>}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-500 font-semibold text-white uppercase">
          {(from?.name || from?.email || "?").charAt(0)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          {from ? (
            <p className="truncate">
              <span className="font-medium">{from.name || from.email}</span>{" "}
              {from.name && <span className={cn("text-[13px]", muted)}>&lt;{from.email}&gt;</span>}
            </p>
          ) : (
            <Link
              to="/senders"
              className={cn("font-medium underline", dark ? "text-amber-400" : "text-amber-700")}
            >
              Add a sender
            </Link>
          )}
          <p className={cn("mt-0.5 text-xs", muted)}>to me</p>
        </div>
        <span className={cn("shrink-0 text-xs", muted)}>{time}</span>
      </div>
    </div>
  )
}

function EmailFrame({ html, scheme, grow }: { html: string; scheme: Scheme; grow: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null)
  // A new srcDoc reloads the frame at the top; keep the reader where they were.
  const scrollY = useRef(0)
  const resize = useRef<ResizeObserver | null>(null)
  useEffect(() => () => resize.current?.disconnect(), [])

  return (
    <iframe
      title="Email preview"
      ref={frame}
      sandbox="allow-same-origin"
      srcDoc={withScheme(html, scheme)}
      style={{ colorScheme: scheme, backgroundColor: PALETTE[scheme].bg }}
      onLoad={() => {
        const view = frame.current?.contentWindow
        if (!view) return
        view.scrollTo(0, scrollY.current)
        view.addEventListener("scroll", () => {
          scrollY.current = view.scrollY
        })
        resize.current?.disconnect()
        if (!grow) return
        // Hidden frames measure nothing, so this also runs when the Preview tab opens.
        const { ResizeObserver } = view as Window & typeof globalThis
        const observer = new ResizeObserver(() => {
          const fit = !window.matchMedia("(min-width: 64rem)").matches
          const height = view.document.documentElement.scrollHeight
          frame.current!.style.height = fit ? `${height}px` : ""
        })
        observer.observe(view.document.body)
        resize.current = observer
      }}
      className={cn("min-h-0 w-full flex-1", grow && "max-lg:flex-none")}
    />
  )
}

function SchemeToggle({ value, onChange }: { value: Scheme; onChange: (scheme: Scheme) => void }) {
  const dark = value === "dark"
  return (
    <div
      role="group"
      aria-label="Preview in"
      className={cn(
        "inline-flex justify-self-end rounded-lg p-0.5",
        dark ? "bg-stone-800" : "bg-stone-200/70"
      )}
    >
      {(["light", "dark"] as const).map((scheme) => (
        <button
          key={scheme}
          type="button"
          aria-pressed={value === scheme}
          onClick={() => onChange(scheme)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors [&_svg]:size-3.5",
            value === scheme
              ? dark
                ? "bg-stone-600 text-stone-50 shadow-xs"
                : "bg-white text-stone-900 shadow-xs"
              : dark
                ? "text-stone-400 hover:text-stone-200"
                : "text-stone-500 hover:text-stone-800"
          )}
        >
          {scheme === "light" ? <SunIcon /> : <MoonIcon />}
          {scheme === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  )
}

const SCHEME_KEY = "sendr:preview-scheme"
const schemeListeners = new Set<() => void>()

/** Light or dark, remembered on this device; the server renders light. */
function usePreviewScheme() {
  const scheme = useSyncExternalStore<Scheme>(
    (listener) => {
      schemeListeners.add(listener)
      return () => schemeListeners.delete(listener)
    },
    () => (localStorage.getItem(SCHEME_KEY) === "dark" ? "dark" : "light"),
    () => "light"
  )
  const setScheme = (next: Scheme) => {
    localStorage.setItem(SCHEME_KEY, next)
    schemeListeners.forEach((listener) => listener())
  }
  return [scheme, setScheme] as const
}
