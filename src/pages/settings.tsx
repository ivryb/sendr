import { useState, type FormEvent, type ReactNode } from "react"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { toast } from "sonner"

import { CopyField } from "@/components/copy-button"
import { PageHeader } from "@/components/page-header"
import { SettingsSection } from "@/components/settings-section"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { api, ApiError, queries } from "@/lib/api"
import { ApiKeysSection } from "@/pages/settings-api-keys"
import { PasskeysSection } from "@/pages/settings-passkeys"
import type { Settings } from "../../shared/model"

type EditableKey = Exclude<keyof Settings, "webhookSecret">

type Values = Partial<Record<EditableKey, string>>

type FieldConfig = {
  name: EditableKey
  label: string
  type?: "email" | "url"
  placeholder?: string
  description?: ReactNode
  multiline?: boolean
}

export function SettingsPage() {
  const settings = useSuspenseQuery(queries.settings).data
  return (
    <div className="flex flex-col gap-2">
      <PageHeader title="Settings" />
      <div className="flex flex-col divide-y">
        <SettingsForm
          settings={settings}
          title="Sender"
          description="Who your campaigns come from. The address must be verified in Amazon SES."
          fields={[
            { name: "fromName", label: "Name", placeholder: "Ada from Acme" },
            {
              name: "fromEmail",
              label: "Email",
              type: "email",
              placeholder: "news@acme.com",
            },
            {
              name: "replyTo",
              label: "Reply-to",
              type: "email",
              placeholder: "ada@acme.com",
              description:
                "Optional. Where replies go, if not the address above.",
            },
          ]}
        />
        <SettingsForm
          settings={settings}
          title="Footer"
          description="Shown at the bottom of every email, above the unsubscribe link Sendr adds."
          fields={[
            {
              name: "footer",
              label: "Footer",
              multiline: true,
              placeholder: "Acme Inc.\n1 Main Street, Springfield, CA 90000",
              description:
                "Include your postal address. Anti-spam laws like CAN-SPAM require one in every marketing email. Markdown works here.",
            },
          ]}
        />
        <SettingsForm
          settings={settings}
          title="Public URL"
          description="Where this Sendr is reachable. Unsubscribe links and the SES events endpoint use it."
          fields={[
            {
              name: "publicUrl",
              label: "Public URL",
              type: "url",
              placeholder: "https://sendr.acme.com",
            },
          ]}
        />
        <ApiKeysSection />
        <SesEventsSection settings={settings} />
        <PasskeysSection />
      </div>
    </div>
  )
}

function SettingsForm({
  settings,
  title,
  description,
  fields,
}: {
  settings: Settings
  title: string
  description: string
  fields: FieldConfig[]
}) {
  const queryClient = useQueryClient()
  const pick = (from: Settings): Values =>
    Object.fromEntries(fields.map((field) => [field.name, from[field.name]]))
  const [values, setValues] = useState(() => pick(settings))
  const save = useMutation({
    mutationFn: (body: Values) =>
      api<Settings>("/api/admin/settings", { method: "PUT", body }),
    onSuccess: (next) => {
      queryClient.setQueryData(queries.settings.queryKey, next)
      setValues(pick(next))
      toast.success(`${title} saved`)
    },
    meta: { silent: true },
  })
  const dirty = fields.some(
    (field) => values[field.name] !== settings[field.name]
  )
  const error = save.error instanceof ApiError ? save.error : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate(values)
  }

  return (
    <SettingsSection title={title} description={description}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <FieldGroup className="gap-5">
          {fields.map((field) => {
            const message = error?.fieldError(field.name)
            const Control = field.multiline ? Textarea : Input
            return (
              <Field key={field.name} data-invalid={message ? true : undefined}>
                {fields.length > 1 && (
                  <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
                )}
                <Control
                  id={field.name}
                  aria-label={field.label}
                  type={field.multiline ? undefined : field.type}
                  value={values[field.name] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    setValues({ ...values, [field.name]: event.target.value })
                  }
                  aria-invalid={message ? true : undefined}
                  className={
                    field.multiline
                      ? "min-h-28 font-mono text-[13px]"
                      : undefined
                  }
                />
                {message && <FieldError>{message}</FieldError>}
                {field.description && (
                  <FieldDescription>{field.description}</FieldDescription>
                )}
              </Field>
            )
          })}
        </FieldGroup>
        {error && !fields.some((field) => error.fieldError(field.name)) && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
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

function SesEventsSection({ settings }: { settings: Settings }) {
  const endpoint = settings.publicUrl && `${settings.publicUrl}/hooks/ses`
  return (
    <SettingsSection
      title="SES events"
      description="Lets Amazon SES report deliveries, bounces and complaints, so Sendr stops emailing addresses that bounce or report spam."
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Endpoint</span>
          {endpoint ? (
            <CopyField value={endpoint} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Set the public URL above first.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            Secret for the{" "}
            <code className="font-mono text-[13px]">x-sendr-secret</code> header
          </span>
          <CopyField value={settings.webhookSecret} />
        </div>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm/relaxed text-muted-foreground marker:text-muted-foreground/70">
          <li>
            In Amazon SES, add an event destination to the configuration set you
            send with. Pick deliveries, bounces and complaints, and send them to
            Amazon EventBridge.
          </li>
          <li>
            In EventBridge, create an API destination that POSTs to the endpoint
            above. Give its connection API key auth with header{" "}
            <code className="font-mono text-foreground">x-sendr-secret</code>{" "}
            and the secret as the value.
          </li>
          <li>
            Add a rule that matches SES events for that configuration set and
            targets the API destination.
          </li>
        </ol>
      </div>
    </SettingsSection>
  )
}
