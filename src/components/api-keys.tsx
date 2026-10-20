import { useState, type FormEvent } from "react"
import { CheckIcon, KeyRoundIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { CopyField } from "@/components/copy-button"
import { Badge } from "@/components/ui/badge"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api"
import { useDates } from "@/lib/format"
import { useChange } from "@/lib/mutations"
import {
  API_KEY_ACCESS,
  type ApiKey,
  type ApiKeyAccess,
} from "../../shared/model"

const ACCESS: Record<ApiKeyAccess, { label: string; description: string }> = {
  contacts: {
    label: "Contacts",
    description: "Add, update and remove contacts. For your app's backend.",
  },
  emails: {
    label: "Emails",
    description: "Send single emails, like receipts and welcome notes.",
  },
  full: {
    label: "Full access",
    description:
      "Everything, including campaigns, senders and settings. For agents.",
  },
}

export function ApiKeys({ apiKeys }: { apiKeys: ApiKey[] }) {
  return (
    <div className="flex flex-col gap-4">
      {apiKeys.length > 0 && (
        <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
          {apiKeys.map((key) => (
            <ApiKeyRow key={key.id} apiKey={key} />
          ))}
        </ul>
      )}
      <CreateKeyDialog />
    </div>
  )
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKey }) {
  const { formatDate } = useDates()
  const [open, setOpen] = useState(false)
  const revoke = useChange({
    mutationFn: () =>
      api(`/api/v1/api-keys/${apiKey.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setOpen(false)
      toast.success(`${apiKey.name} revoked`)
    },
  })
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{apiKey.name}</span>
          <Badge
            variant="outline"
            className="font-normal text-muted-foreground"
          >
            {ACCESS[apiKey.access].label}
          </Badge>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          <code className="font-mono">{apiKey.prefix}…</code>{" "}
          {apiKey.lastUsedAt
            ? `used ${formatDate(apiKey.lastUsedAt)}`
            : `created ${formatDate(apiKey.createdAt)}, not used yet`}
        </span>
      </div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Revoke
        </Button>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {apiKey.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything using this key stops working right away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => revoke.mutate()}
              disabled={revoke.isPending}
            >
              {revoke.isPending && <Spinner />}
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

function CreateKeyDialog() {
  const [open, setOpen] = useState(false)
  const [access, setAccess] = useState<ApiKeyAccess>("contacts")
  const create = useChange({
    mutationFn: (name: string) =>
      api<{ key: string }>("/api/v1/api-keys", { body: { name, access } }),
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    create.mutate(String(new FormData(event.currentTarget).get("name")).trim())
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) create.reset()
      }}
    >
      <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <PlusIcon />
        Create API key
      </Button>
      <DialogContent>
        {create.data ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your new key</DialogTitle>
              <DialogDescription>
                Store it with the app or agent that uses it now. It won't be
                shown again.
              </DialogDescription>
            </DialogHeader>
            <CopyField value={create.data.key} />
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-6">
            <DialogHeader>
              <DialogTitle>Create an API key</DialogTitle>
              <DialogDescription>
                Make one per app or agent, with only the access it needs.
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="key-name">Name</FieldLabel>
              <Input
                id="key-name"
                name="name"
                required
                autoFocus
                placeholder="Acme web app"
              />
            </Field>
            <div
              role="radiogroup"
              aria-label="Access"
              className="flex flex-col gap-2"
            >
              <span className="text-sm font-medium">Access</span>
              {API_KEY_ACCESS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={access === value}
                  onClick={() => setAccess(value)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg px-3 py-2.5 text-left ring-1 ring-foreground/10 transition-colors hover:bg-muted/50",
                    access === value && "ring-2 ring-primary"
                  )}
                >
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {ACCESS[value].label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ACCESS[value].description}
                    </span>
                  </span>
                  {access === value && <CheckIcon className="mt-0.5 size-4" />}
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Spinner />}
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
