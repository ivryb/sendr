import { useState, type FormEvent } from "react"
import { KeyRoundIcon, PlusIcon } from "lucide-react"
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
import { Checkbox } from "@/components/ui/checkbox"
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
  API_KEY_PERMISSIONS,
  type ApiKey,
  type ApiKeyPermission,
} from "../../shared/model"

const PERMISSIONS: Record<
  ApiKeyPermission,
  { label: string; description: string }
> = {
  contacts: {
    label: "Contacts",
    description: "Add, update and remove contacts.",
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
            {permissionsLabel(apiKey.permissions)}
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

/** "Contacts, Emails", or "Full access", which covers the rest. */
function permissionsLabel(permissions: ApiKeyPermission[]) {
  if (permissions.includes("full")) return PERMISSIONS.full.label
  return permissions
    .map((permission) => PERMISSIONS[permission].label)
    .join(", ")
}

function CreateKeyDialog() {
  const [open, setOpen] = useState(false)
  const [permissions, setPermissions] = useState<ApiKeyPermission[]>([
    "contacts",
  ])
  const full = permissions.includes("full")
  // Full access covers the others, so they show as checked and can't be changed.
  const toggle = (permission: ApiKeyPermission, checked: boolean) =>
    setPermissions((current) =>
      permission === "full"
        ? checked
          ? ["full"]
          : []
        : checked
          ? [...current, permission]
          : current.filter((item) => item !== permission)
    )
  const create = useChange({
    mutationFn: (name: string) =>
      api<{ key: string }>("/api/v1/api-keys", {
        body: { name, permissions },
      }),
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
                Make one per app or agent, with only the permissions it needs.
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
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Permissions</legend>
              {API_KEY_PERMISSIONS.map((permission) => {
                const covered = full && permission !== "full"
                return (
                  <label
                    key={permission}
                    className={cn(
                      "flex items-start gap-3 rounded-lg px-3 py-2.5 ring-1 ring-foreground/10 transition-colors has-[[data-checked]]:bg-muted/40",
                      covered
                        ? "opacity-60"
                        : "cursor-pointer hover:bg-muted/50"
                    )}
                  >
                    <Checkbox
                      checked={covered || permissions.includes(permission)}
                      disabled={covered}
                      onCheckedChange={(checked) => toggle(permission, checked)}
                      className="mt-0.5"
                    />
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {PERMISSIONS[permission].label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {PERMISSIONS[permission].description}
                      </span>
                    </span>
                  </label>
                )
              })}
              <p className="pt-1 text-xs text-muted-foreground">
                An app's backend usually needs Contacts, Emails or both. Give
                Full access only to agents you trust to run campaigns.
              </p>
            </fieldset>
            <DialogFooter>
              <Button
                type="submit"
                disabled={create.isPending || permissions.length === 0}
              >
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
