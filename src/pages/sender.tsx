import { useState, type FormEvent, type ReactNode } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  CheckIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  CopyIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
} from "lucide-react"
import { data, useNavigate, useNavigation, useRevalidator } from "react-router"
import { toast } from "sonner"
import { cn } from "cn"

import type { Route } from "./+types/sender"
import { PageHeader } from "@/components/page-header"
import {
  BackToSenders,
  SENDER_SERVICES,
  SenderStatusBadge,
  SetupSteps,
} from "@/components/senders"
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { api, ApiError } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { useChange } from "@/lib/mutations"
import { usePolling } from "@/lib/use-polling"
import type { DnsRecord, Sender } from "../../shared/model"
import { checkSender, SenderError } from "../../worker/domain/senders"

export async function loader({ params }: Route.LoaderArgs) {
  return checkSender(params.id).catch((error) => {
    if (error instanceof SenderError && error.code === "not_found") {
      throw data(null, { status: 404 })
    }
    throw error
  })
}

export default function SenderPage({ loaderData }: Route.ComponentProps) {
  const check = loaderData
  const { sender } = check
  const ready = check.ok && sender.verified && sender.production
  // DNS changes and AWS approval happen elsewhere; keep looking until they land.
  usePolling(check.ok && !sender.verified ? 30_000 : false)

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-4">
        <BackToSenders />
        <PageHeader
          title={sender.email}
          description={`${sender.name ? `${sender.name}, through` : "Through"} ${SENDER_SERVICES[sender.provider]} in ${sender.region}`}
          actions={
            check.ok ? (
              <SenderStatusBadge sender={sender} />
            ) : (
              <Badge variant="outline" className="gap-1.5 font-normal">
                <span className="size-1.5 rounded-full bg-red-500" />
                Can't connect
              </Badge>
            )
          }
        />
        {check.ok && !ready && <SetupSteps current={2} />}
      </div>

      {check.ok ? (
        <ol className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10">
          <Step done title="Connected to Amazon SES">
            The access key works. Sendr sends through the{" "}
            <code className="font-mono text-foreground">sendr</code>{" "}
            configuration set in {sender.region}.
          </Step>
          <DomainStep
            domain={check.domain}
            verified={sender.verified}
            records={check.records}
          />
          <Step done={sender.eventsConnected} title="Delivery reports">
            {sender.eventsConnected
              ? "SES reports deliveries, bounces and complaints to Sendr, so it stops emailing addresses that bounce."
              : "Waiting for AWS to confirm the report subscription. That happens on its own within a minute, as long as Sendr is reachable at its public URL."}
          </Step>
          <Step
            done={sender.production}
            title={
              sender.production
                ? "Production access"
                : "Your SES account is in the sandbox"
            }
            action={
              !sender.production && (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={
                    <a
                      href={`https://console.aws.amazon.com/ses/home?region=${sender.region}#/account`}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  Request access
                  <ExternalLinkIcon />
                </Button>
              )
            }
          >
            {sender.production
              ? `SES lets you send ${formatNumber(check.max24HourSend)} emails a day, ${formatNumber(check.maxSendRate)} a second. Sendr keeps to that pace.`
              : "Until AWS approves production access, SES only sends to addresses you verified in SES, at most 200 a day. AWS usually answers within a day."}
          </Step>
        </ol>
      ) : (
        <ConnectionProblem message={check.error} />
      )}

      <EditSender sender={sender} />
      <RemoveSender sender={sender} />
    </div>
  )
}

function DomainStep({
  domain,
  verified,
  records,
}: {
  domain: string
  verified: boolean
  records: DnsRecord[]
}) {
  const revalidator = useRevalidator()
  return (
    <Step
      done={verified}
      title={
        verified
          ? `${domain} is verified`
          : `Add these DNS records for ${domain}`
      }
      action={
        !verified && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => revalidator.revalidate()}
            disabled={revalidator.state === "loading"}
          >
            {revalidator.state === "loading" ? <Spinner /> : <RefreshCwIcon />}
            Check now
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <p>
          {verified
            ? "SES signs your emails with your domain, so inboxes trust them. Keep these records in place."
            : `Add them where you manage ${domain}'s DNS. Changes can take a few minutes to show up; this page keeps checking.`}
        </p>
        <DnsTable records={records} />
      </div>
    </Step>
  )
}

function ConnectionProblem({ message }: { message: string }) {
  const revalidator = useRevalidator()
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl p-5 ring-1 ring-destructive/30"
    >
      <span className="flex items-center gap-2 font-medium text-destructive">
        <CircleAlertIcon className="size-4" />
        Sendr can't reach this sender's AWS account
      </span>
      <p className="text-sm/relaxed text-muted-foreground">{message}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => revalidator.revalidate()}
        disabled={revalidator.state === "loading"}
      >
        {revalidator.state === "loading" ? <Spinner /> : <RefreshCwIcon />}
        Try again
      </Button>
    </div>
  )
}

function Step({
  done = false,
  title,
  action,
  children,
}: {
  done?: boolean
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <li className="flex gap-4 px-5 py-5">
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full",
          done
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : "text-amber-600"
        )}
      >
        {done ? (
          <CheckIcon className="size-3.5" />
        ) : (
          <CircleDashedIcon className="size-4" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-4">
          <span className="pt-0.5 font-medium">{title}</span>
          {action}
        </div>
        <div className="text-sm/relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  )
}

const RECORD_STATUS: Record<
  DnsRecord["status"],
  { label: string; dot: string }
> = {
  verified: { label: "Found", dot: "bg-emerald-500" },
  pending: { label: "Not found yet", dot: "bg-amber-500" },
  recommended: { label: "Recommended", dot: "bg-muted-foreground/40" },
}

function DnsTable({ records }: { records: DnsRecord[] }) {
  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
      <table className="w-full table-fixed text-left text-[13px]">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="w-16 px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Value</th>
            <th className="hidden w-32 px-3 py-2 font-medium sm:table-cell">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y text-foreground">
          {records.map((record) => {
            const status = RECORD_STATUS[record.status]
            return (
              <tr key={record.name + record.value} className="align-top">
                <td className="px-3 py-2 font-mono">{record.type}</td>
                <td className="px-1 py-1 font-mono">
                  <CopyCell value={record.name} />
                </td>
                <td className="px-1 py-1 font-mono">
                  <CopyCell value={record.value} />
                </td>
                <td className="hidden px-3 py-2 text-xs text-muted-foreground sm:table-cell">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("size-1.5 rounded-full", status.dot)} />
                    {status.label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** The whole value is the copy target, so long DNS names never get cut off. */
function CopyCell({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy"
      className="group flex w-full items-start gap-2 rounded-md px-2 py-1 text-left break-all hover:bg-muted"
    >
      <span className="flex-1">{value}</span>
      {copied ? (
        <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
      ) : (
        <CopyIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
      )}
    </button>
  )
}

function EditSender({ sender }: { sender: Sender }) {
  const [values, setValues] = useState({
    name: sender.name,
    replyTo: sender.replyTo,
  })
  const save = useChange({
    mutationFn: (body: typeof values) =>
      api(`/api/admin/senders/${sender.id}`, { method: "PATCH", body }),
    onSuccess: () => toast.success("Sender saved"),
    meta: { silent: true },
  })
  const dirty = values.name !== sender.name || values.replyTo !== sender.replyTo
  const error = save.error instanceof ApiError ? save.error : null
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate(values)
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <h2 className="font-medium">Details</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input
            id="name"
            value={values.name}
            onChange={(event) =>
              setValues({ ...values, name: event.target.value })
            }
          />
        </Field>
        <Field data-invalid={error?.fieldError("replyTo") ? true : undefined}>
          <FieldLabel htmlFor="replyTo">Reply-to</FieldLabel>
          <Input
            id="replyTo"
            type="email"
            value={values.replyTo}
            placeholder={sender.email}
            onChange={(event) =>
              setValues({ ...values, replyTo: event.target.value })
            }
          />
          {error?.fieldError("replyTo") && (
            <FieldError>{error.fieldError("replyTo")}</FieldError>
          )}
        </Field>
      </div>
      <Button
        type="submit"
        variant={dirty ? "default" : "outline"}
        disabled={!dirty || save.isPending}
        className="w-fit"
      >
        {save.isPending && <Spinner />}
        Save
      </Button>
    </form>
  )
}

function RemoveSender({ sender }: { sender: Sender }) {
  const navigate = useNavigate()
  const navigation = useNavigation()
  const [open, setOpen] = useState(false)
  // Not useChange: reloading this page would find the sender gone before navigating away.
  const remove = useMutation({
    mutationFn: () =>
      api(`/api/admin/senders/${sender.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setOpen(false)
      await navigate("/senders")
      toast.success(`${sender.email} removed`)
    },
    meta: { silent: true },
  })
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) remove.reset()
      }}
    >
      <Button
        variant="ghost"
        className="w-fit text-destructive"
        onClick={() => setOpen(true)}
      >
        Remove sender
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {sender.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            Drafts from this address will need another sender. Its SES setup
            stays in your AWS account.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.error && (
          <p role="alert" className="text-sm text-destructive">
            {remove.error.message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending || navigation.state !== "idle"}
          >
            {remove.isPending && <Spinner />}
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
