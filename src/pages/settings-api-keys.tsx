import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRoundIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { CopyField } from "@/components/copy-button"
import { SettingsSection } from "@/components/settings-section"
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
import { api, queries } from "@/lib/api"
import { formatDate } from "@/lib/format"
import type { ApiKey } from "../../shared/model"

export function ApiKeysSection() {
  const keys = useQuery(queries.apiKeys)
  return (
    <SettingsSection
      title="API keys"
      description="Your app uses a key to add, update and remove contacts. Make one per app so you can revoke them separately."
    >
      <div className="flex flex-col gap-4">
        {keys.data && keys.data.length > 0 && (
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {keys.data.map((key) => (
              <ApiKeyRow key={key.id} apiKey={key} />
            ))}
          </ul>
        )}
        <CreateKeyDialog />
      </div>
    </SettingsSection>
  )
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKey }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const revoke = useMutation({
    mutationFn: () =>
      api(`/api/admin/api-keys/${apiKey.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: queries.apiKeys.queryKey })
      toast.success(`${apiKey.name} revoked`)
    },
  })
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{apiKey.name}</span>
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
              Apps using this key stop syncing contacts right away.
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
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const create = useMutation({
    mutationFn: (name: string) =>
      api<{ key: string }>("/api/admin/api-keys", { body: { name } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queries.apiKeys.queryKey }),
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
                Store it in your app's secrets now. It won't be shown again.
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
                Name it after the app that will use it.
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
