import { useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FingerprintIcon } from "lucide-react"

import { AuthLayout } from "@/components/auth-layout"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { api, queries } from "@/lib/api"
import { useAddPasskey } from "@/lib/passkeys"

export function SetupPage() {
  const [claimed, setClaimed] = useState(false)
  return claimed ? (
    <PasskeyStep />
  ) : (
    <ClaimStep onClaimed={() => setClaimed(true)} />
  )
}

function ClaimStep({ onClaimed }: { onClaimed: () => void }) {
  const claim = useMutation({
    mutationFn: (body: { setupCode: string; name: string; email: string }) =>
      api("/api/auth/setup/claim", { body }),
    onSuccess: onClaimed,
    meta: { silent: true },
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    claim.mutate({
      setupCode: String(form.get("setupCode")),
      name: String(form.get("name")).trim(),
      email: String(form.get("email")).trim(),
    })
  }

  return (
    <AuthLayout
      title="Set up Sendr"
      description="Enter the setup code you chose as the SETUP_CODE secret when you deployed. You'll become this instance's first admin."
    >
      <form onSubmit={submit}>
        <FieldGroup className="gap-5">
          <Field data-invalid={claim.isError || undefined}>
            <FieldLabel htmlFor="setupCode">Setup code</FieldLabel>
            <Input
              id="setupCode"
              name="setupCode"
              required
              autoComplete="off"
              autoFocus
              aria-invalid={claim.isError || undefined}
            />
            {claim.error && <FieldError>{claim.error.message}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="name">Your name</FieldLabel>
            <Input id="name" name="name" required autoComplete="name" />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Your email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
            />
          </Field>
          <Button type="submit" size="lg" disabled={claim.isPending}>
            {claim.isPending && <Spinner />}
            Claim this instance
          </Button>
        </FieldGroup>
      </form>
    </AuthLayout>
  )
}

function PasskeyStep() {
  const queryClient = useQueryClient()
  const finish = () => {
    queryClient.setQueryData(queries.setup.queryKey, { claimed: true })
    queryClient.invalidateQueries({ queryKey: queries.me.queryKey })
  }
  const addPasskey = useAddPasskey({ onAdded: finish })

  return (
    <AuthLayout
      title="You're in"
      description="Add a passkey so next time you sign in with Face ID, Touch ID, or your device PIN. No codes to wait for."
    >
      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          onClick={() => addPasskey.mutate()}
          disabled={addPasskey.isPending}
        >
          {addPasskey.isPending ? <Spinner /> : <FingerprintIcon />}
          Add a passkey to this device
        </Button>
        <Button variant="ghost" size="lg" onClick={finish}>
          Skip for now
        </Button>
      </div>
    </AuthLayout>
  )
}
