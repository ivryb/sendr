import { useState } from "react"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { SearchIcon, UsersIcon } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"
import { cn } from "cn"

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
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, queries } from "@/lib/api"
import { formatDate, formatNumber } from "@/lib/format"
import { useDebounced } from "@/lib/use-debounced"
import {
  CONTACT_STATUSES,
  type Contact,
  type ContactStatus,
} from "../../shared/model"

const PAGE_SIZE = 50

const CONTACT_STATUS: Record<ContactStatus, { label: string; dot: string }> = {
  subscribed: { label: "Subscribed", dot: "bg-emerald-500" },
  unsubscribed: { label: "Unsubscribed", dot: "bg-muted-foreground/40" },
  bounced: { label: "Bounced", dot: "bg-amber-500" },
  complained: { label: "Complained", dot: "bg-red-500" },
}

export function ContactsPage() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<ContactStatus | undefined>()
  const [offset, setOffset] = useState(0)
  const q = useDebounced(search.trim())
  const contacts = useQuery({
    ...queries.contacts({
      q: q || undefined,
      status,
      limit: PAGE_SIZE,
      offset,
    }),
    placeholderData: keepPreviousData,
  })
  const counts = contacts.data?.counts ?? {}
  const everyone = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0)

  if (contacts.isPending) return <ContactsSkeleton />
  if (everyone === 0) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Contacts" />
        <ConnectContacts />
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
  const total = contacts.data?.total ?? 0
  const rows = contacts.data?.contacts ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contacts"
        description="Your app keeps this list in sync through the contacts API."
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {filters.map((filter) => (
            <button
              key={filter.label}
              type="button"
              onClick={() => {
                setStatus(filter.value)
                setOffset(0)
              }}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                status === filter.value &&
                  "bg-muted font-medium text-foreground"
              )}
            >
              {filter.label}
              <span className="text-xs tabular-nums opacity-70">
                {formatNumber(filter.count)}
              </span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setOffset(0)
            }}
            placeholder="Search email or name"
            aria-label="Search contacts"
            className="pl-8"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Email</TableHead>
              <TableHead className="hidden md:table-cell">Name</TableHead>
              <TableHead className="hidden lg:table-cell">
                External ID
              </TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="hidden sm:table-cell">Added</TableHead>
              <TableHead className="pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((contact) => (
              <ContactRow key={contact.id} contact={contact} />
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-muted-foreground"
                >
                  No contacts match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {formatNumber(offset + 1)} to{" "}
            {formatNumber(Math.min(offset + PAGE_SIZE, total))} of{" "}
            {formatNumber(total)}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
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
  const meta = CONTACT_STATUS[contact.status]
  return (
    <TableRow>
      <TableCell className="max-w-0 pl-4 sm:max-w-none">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{contact.email}</span>
          <span className="truncate text-xs text-muted-foreground md:hidden">
            <span className="sm:hidden">
              {[meta.label, contact.firstName].filter(Boolean).join(", ")}
            </span>
            <span className="hidden sm:inline">{contact.firstName}</span>
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {contact.firstName}
      </TableCell>
      <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
        {contact.externalId}
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <span className="inline-flex items-center gap-1.5 text-sm">
          <span className={cn("size-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>
      </TableCell>
      <TableCell className="hidden text-muted-foreground sm:table-cell">
        {formatDate(contact.createdAt)}
      </TableCell>
      <TableCell className="w-0 pr-4 text-right">
        <StatusAction contact={contact} />
      </TableCell>
    </TableRow>
  )
}

function StatusAction({ contact }: { contact: Contact }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const change = useMutation({
    mutationFn: (status: "subscribed" | "unsubscribed") =>
      api(`/api/admin/contacts/${contact.id}/status`, { body: { status } }),
    onSuccess: (_, status) => {
      setConfirming(false)
      queryClient.invalidateQueries({ queryKey: ["contacts"] })
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

function ConnectContacts() {
  const settings = useQuery(queries.settings).data
  const origin = settings?.publicUrl || window.location.origin
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
          are, so the list stays current on its own. Create an API key in{" "}
          <Link to="/settings">Settings</Link>, then call the contacts API
          whenever someone signs up or changes their email.
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

function ContactsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  )
}
