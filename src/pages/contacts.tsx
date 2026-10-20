import { useEffect, useRef, useState } from "react"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleMinusIcon,
  CircleXIcon,
  SearchIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"
import { Link, useNavigation, useSearchParams } from "react-router"
import { toast } from "sonner"
import { cn } from "cn"

import type { Route } from "./+types/contacts"

import { CodeBlock } from "@/components/code-block"
import { PageHeader } from "@/components/page-header"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { formatNumber, useDates } from "@/lib/format"
import { useChange } from "@/lib/mutations"
import {
  CONTACT_STATUSES,
  type Contact,
  type ContactStatus,
} from "../../shared/model"
import { contactCounts, listContacts } from "../../worker/domain/contacts"
import { getSettings } from "../../worker/lib/settings"

const PAGE_SIZE = 50

/** The search, status filter and page live in the URL, so each view can be linked and reloaded. */
export async function loader({ url }: Route.LoaderArgs) {
  const params = url.searchParams
  const filter = {
    q: params.get("q")?.trim() || undefined,
    status: CONTACT_STATUSES.find((status) => status === params.get("status")),
    offset: Math.max(0, Number(params.get("offset")) || 0),
  }
  const [list, counts, settings] = await Promise.all([
    listContacts({ ...filter, limit: PAGE_SIZE }),
    contactCounts() as Promise<Partial<Record<ContactStatus, number>>>,
    getSettings(),
  ])
  return { ...list, counts, filter, origin: settings.publicUrl || url.origin }
}

// Filled icons: the stroke takes the background color, so the mark reads as cut out.
const CONTACT_STATUS: Record<
  ContactStatus,
  { label: string; icon: LucideIcon; fill: string }
> = {
  subscribed: {
    label: "Subscribed",
    icon: CircleCheckIcon,
    fill: "fill-emerald-500",
  },
  unsubscribed: {
    label: "Unsubscribed",
    icon: CircleMinusIcon,
    fill: "fill-muted-foreground/50",
  },
  bounced: { label: "Bounced", icon: CircleAlertIcon, fill: "fill-amber-500" },
  complained: { label: "Complained", icon: CircleXIcon, fill: "fill-red-500" },
}

export default function ContactsPage({ loaderData }: Route.ComponentProps) {
  const { contacts: rows, total, counts, filter, origin } = loaderData
  const [, setSearchParams] = useSearchParams()
  // A new filter keeps the current rows, dimmed, until its own have loaded.
  const updating = useNavigation().location?.pathname === "/contacts"
  const show = (patch: Partial<typeof filter>) => {
    const next = { ...filter, offset: 0, ...patch }
    const params = new URLSearchParams()
    if (next.q) params.set("q", next.q)
    if (next.status) params.set("status", next.status)
    if (next.offset) params.set("offset", String(next.offset))
    setSearchParams(params, { replace: true, preventScrollReset: true })
  }
  const [search, setSearch] = useState(filter.q ?? "")
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const changeSearch = (value: string) => {
    setSearch(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(
      () => show({ q: value.trim() || undefined }),
      300
    )
  }
  // A search still waiting to run must not pull the admin back here after they leave.
  useEffect(() => () => clearTimeout(searchTimer.current), [])
  const everyone = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0)

  if (everyone === 0) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Contacts" />
        <ConnectContacts origin={origin} />
      </div>
    )
  }

  const filters: {
    value: ContactStatus | undefined
    label: string
    count: number
  }[] = [
    { value: undefined, label: "All", count: everyone },
    ...CONTACT_STATUSES.map((value) => ({
      value,
      label: CONTACT_STATUS[value].label,
      count: counts[value] ?? 0,
    })),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contacts"
        description="Your app keeps this list in sync through the contacts API."
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {filters.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => show({ status: option.value })}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                filter.status === option.value &&
                  "bg-muted font-medium text-foreground"
              )}
            >
              {option.label}
              <span className="text-xs tabular-nums opacity-70">
                {formatNumber(option.count)}
              </span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="Search email or name"
            aria-label="Search contacts"
            className="pl-8"
          />
        </div>
      </div>

      <div
        className={cn(
          "@container overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-opacity",
          updating && "opacity-60"
        )}
      >
        {/*
          Fixed column widths, so switching filters doesn't reflow the table. Columns appear
          as the table (not the window) gets wider, since the sidebar takes part of the window.
        */}
        <Table className="table-fixed">
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11 pl-4">Email</TableHead>
              <TableHead className="hidden w-36 @3xl:table-cell">
                Name
              </TableHead>
              <TableHead className="hidden w-28 @4xl:table-cell">
                External ID
              </TableHead>
              <TableHead className="hidden w-36 @lg:table-cell">
                Status
              </TableHead>
              <TableHead className="hidden w-28 @2xl:table-cell">
                Added
              </TableHead>
              <TableHead className="w-32 pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_td]:py-3">
            {rows.map((contact) => (
              <ContactRow key={contact.id} contact={contact} />
            ))}
          </TableBody>
        </Table>
        {/* Outside the table: a spanning cell would count columns hidden at this width. */}
        {rows.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No contacts match.
          </p>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {formatNumber(filter.offset + 1)} to{" "}
            {formatNumber(Math.min(filter.offset + PAGE_SIZE, total))} of{" "}
            {formatNumber(total)}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={filter.offset === 0}
              onClick={() =>
                show({ offset: Math.max(0, filter.offset - PAGE_SIZE) })
              }
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filter.offset + PAGE_SIZE >= total}
              onClick={() => show({ offset: filter.offset + PAGE_SIZE })}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ContactRow({ contact }: { contact: Contact }) {
  const { formatDate } = useDates()
  const meta = CONTACT_STATUS[contact.status]
  return (
    <TableRow>
      <TableCell className="pl-4">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{contact.email}</span>
          <span className="truncate text-xs text-muted-foreground @3xl:hidden">
            <span className="@lg:hidden">
              {[meta.label, contact.firstName].filter(Boolean).join(", ")}
            </span>
            <span className="hidden @lg:inline">{contact.firstName}</span>
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden truncate @3xl:table-cell">
        {contact.firstName}
      </TableCell>
      <TableCell className="hidden truncate font-mono text-xs text-muted-foreground @4xl:table-cell">
        {contact.externalId}
      </TableCell>
      <TableCell className="hidden @lg:table-cell">
        <Badge
          variant="outline"
          className="gap-1 px-1.5 font-normal text-muted-foreground"
        >
          <meta.icon className={cn("size-3.5 text-card", meta.fill)} />
          {meta.label}
        </Badge>
      </TableCell>
      <TableCell className="hidden text-muted-foreground @2xl:table-cell">
        {formatDate(contact.createdAt)}
      </TableCell>
      <TableCell className="pr-4 text-right">
        <StatusAction contact={contact} />
      </TableCell>
    </TableRow>
  )
}

function StatusAction({ contact }: { contact: Contact }) {
  const [confirming, setConfirming] = useState(false)
  const change = useChange({
    mutationFn: (status: "subscribed" | "unsubscribed") =>
      api(`/api/v1/contacts/${contact.id}/status`, { body: { status } }),
    onSuccess: (_, status) => {
      setConfirming(false)
      toast.success(
        status === "subscribed"
          ? `${contact.email} is subscribed again`
          : `${contact.email} is unsubscribed`
      )
    },
  })

  if (contact.status === "subscribed") {
    return (
      <Button
        variant="ghost"
        size="xs"
        onClick={() => change.mutate("unsubscribed")}
        disabled={change.isPending}
      >
        Unsubscribe
      </Button>
    )
  }
  if (contact.status !== "unsubscribed") return null
  return (
    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <Button variant="ghost" size="xs" onClick={() => setConfirming(true)}>
        Resubscribe
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Resubscribe {contact.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            Only do this if they asked to get your emails again. Emailing people
            who unsubscribed breaks anti-spam law.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => change.mutate("subscribed")}
            disabled={change.isPending}
          >
            They asked, resubscribe
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ConnectContacts({ origin }: { origin: string }) {
  const single = `curl -X PUT ${origin}/api/v1/contacts/user_123 \\
  -H "Authorization: Bearer <api key>" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "ada@example.com", "firstName": "Ada", "fields": {"plan": "pro"}}'`
  const batch = `curl -X POST ${origin}/api/v1/contacts/batch \\
  -H "Authorization: Bearer <api key>" \\
  -H "Content-Type: application/json" \\
  -d '{"contacts": [{"externalId": "user_123", "email": "ada@example.com"}]}'`

  return (
    <Empty className="items-stretch border p-6 text-left sm:p-10">
      <EmptyHeader className="max-w-xl items-start">
        <EmptyMedia variant="icon">
          <UsersIcon />
        </EmptyMedia>
        <EmptyTitle>Connect your contacts</EmptyTitle>
        <EmptyDescription>
          Sendr doesn't import spreadsheets. Your app tells it who your users
          are, so the list stays current on its own. Create a key on the{" "}
          <Link to="/api">API</Link> page, then call the contacts API whenever
          someone signs up or changes their email.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-none items-stretch gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Add or update one contact by your own user ID. Set{" "}
            <code className="font-mono text-foreground">
              "unsubscribed": true
            </code>{" "}
            when someone opts out in your app.
          </p>
          <CodeBlock code={single} />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Or send up to 100 at a time.
          </p>
          <CodeBlock code={batch} />
        </div>
      </EmptyContent>
    </Empty>
  )
}
