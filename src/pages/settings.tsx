import { useState, type FormEvent } from "react"
import { toast } from "sonner"

import type { Route } from "./+types/settings"
import { PageHeader } from "@/components/page-header"
import { SettingsSection } from "@/components/settings-section"
import { Button } from "@/components/ui/button"
import { Field, FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { adminContext } from "@/lib/admin.server"
import { api, ApiError } from "@/lib/api"
import { useChange } from "@/lib/mutations"
import { PasskeysSection } from "@/pages/settings-passkeys"
import type { Settings } from "../../shared/model"
import { listPasskeys } from "../../worker/auth"
import { getSettings, toSettingsDto } from "../../worker/lib/settings"

export async function loader({ context }: Route.LoaderArgs) {
  const [settings, passkeys] = await Promise.all([
    getSettings(),
    listPasskeys(context.get(adminContext).id),
  ])
  return { settings: toSettingsDto(settings), passkeys }
}

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  const { settings, passkeys } = loaderData
  return (
    <div className="flex flex-col gap-2">
      <PageHeader title="Settings" />
      <div className="flex flex-col divide-y">
        <PublicUrlSection publicUrl={settings.publicUrl} />
        <PasskeysSection passkeys={passkeys} />
      </div>
    </div>
  )
}

function PublicUrlSection({ publicUrl }: { publicUrl: string }) {
  const [value, setValue] = useState(publicUrl)
  const save = useChange({
    mutationFn: (next: string) =>
      api<Settings>("/api/v1/settings", {
        method: "PUT",
        body: { publicUrl: next },
      }),
    onSuccess: (next) => {
      setValue(next.publicUrl)
      toast.success("Public URL saved")
    },
    meta: { silent: true },
  })
  const error = save.error instanceof ApiError ? save.error : null
  const dirty = value !== publicUrl

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate(value)
  }

  return (
    <SettingsSection
      title="Public URL"
      description="Where this Sendr is reachable. Unsubscribe links and delivery reports use it. Your first sign-in filled it in."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field data-invalid={error ? true : undefined}>
          <Input
            aria-label="Public URL"
            type="url"
            value={value}
            placeholder="https://sendr.acme.com"
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={error ? true : undefined}
          />
          {error && (
            <FieldError>
              {error.fieldError("publicUrl") ?? error.message}
            </FieldError>
          )}
        </Field>
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
    </SettingsSection>
  )
}
