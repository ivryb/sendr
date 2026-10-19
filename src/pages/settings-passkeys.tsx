import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FingerprintIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { SettingsSection } from "@/components/settings-section"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { authClient, unwrap } from "@/lib/auth-client"
import { formatDate } from "@/lib/format"
import { passkeysQuery, useAddPasskey } from "@/lib/passkeys"

export function PasskeysSection() {
  const passkeys = useQuery(passkeysQuery)
  const addPasskey = useAddPasskey()
  return (
    <SettingsSection
      title="Passkeys"
      description="Sign in with Face ID, Touch ID, or your device PIN. Add one on each device you use. You can always sign in with an email code too."
    >
      <div className="flex flex-col gap-4">
        {passkeys.data && passkeys.data.length > 0 && (
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {passkeys.data.map((passkey) => (
              <PasskeyRow
                key={passkey.id}
                id={passkey.id}
                name={passkey.name || "Passkey"}
                createdAt={passkey.createdAt}
              />
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => addPasskey.mutate()}
          disabled={addPasskey.isPending}
        >
          {addPasskey.isPending ? <Spinner /> : <PlusIcon />}
          Add a passkey on this device
        </Button>
      </div>
    </SettingsSection>
  )
}

function PasskeyRow({
  id,
  name,
  createdAt,
}: {
  id: string
  name: string
  createdAt: Date
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => unwrap(authClient.passkey.deletePasskey({ id })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey })
      toast.success(`${name} passkey removed`)
    },
  })
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <FingerprintIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="text-xs text-muted-foreground">
          Added {formatDate(createdAt)}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => remove.mutate()}
        disabled={remove.isPending}
      >
        Remove
      </Button>
    </li>
  )
}
