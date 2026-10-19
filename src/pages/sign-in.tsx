import { useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FingerprintIcon, MailIcon } from "lucide-react"
import { REGEXP_ONLY_DIGITS } from "input-otp"

import { AuthLayout } from "@/components/auth-layout"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Spinner } from "@/components/ui/spinner"
import { queries } from "@/lib/api"
import { authClient, unwrap } from "@/lib/auth-client"

type Step =
  { name: "choose" } | { name: "email" } | { name: "code"; email: string }

export function SignInPage() {
  const [step, setStep] = useState<Step>({ name: "choose" })
  const queryClient = useQueryClient()
  const signedIn = () =>
    queryClient.invalidateQueries({ queryKey: queries.me.queryKey })

  if (step.name === "code") {
    return (
      <CodeStep
        email={step.email}
        onSignedIn={signedIn}
        onBack={() => setStep({ name: "email" })}
      />
    )
  }
  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back. Use the passkey on this device, or get a sign-in code by email."
    >
      {step.name === "choose" ? (
        <ChooseStep
          onSignedIn={signedIn}
          onEmail={() => setStep({ name: "email" })}
        />
      ) : (
        <EmailStep
          onSent={(email) => setStep({ name: "code", email })}
          onBack={() => setStep({ name: "choose" })}
        />
      )}
    </AuthLayout>
  )
}

function ChooseStep({
  onSignedIn,
  onEmail,
}: {
  onSignedIn: () => void
  onEmail: () => void
}) {
  const passkey = useMutation({
    mutationFn: () => unwrap(authClient.signIn.passkey()),
    onSuccess: onSignedIn,
    meta: { silent: true },
  })
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        onClick={() => passkey.mutate()}
        disabled={passkey.isPending}
      >
        {passkey.isPending ? <Spinner /> : <FingerprintIcon />}
        Sign in with passkey
      </Button>
      <Button variant="outline" size="lg" onClick={onEmail}>
        <MailIcon />
        Email me a code
      </Button>
      {passkey.error && (
        <p role="alert" className="pt-2 text-sm text-destructive">
          {passkey.error.message}
        </p>
      )}
    </div>
  )
}

function EmailStep({
  onSent,
  onBack,
}: {
  onSent: (email: string) => void
  onBack: () => void
}) {
  const send = useMutation({
    mutationFn: (email: string) =>
      unwrap(
        authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
      ),
    onSuccess: (_, email) => onSent(email),
    meta: { silent: true },
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    send.mutate(String(new FormData(event.currentTarget).get("email")).trim())
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Field data-invalid={send.isError || undefined}>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
        />
        {send.error && <FieldError>{send.error.message}</FieldError>}
      </Field>
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" disabled={send.isPending}>
          {send.isPending && <Spinner />}
          Send code
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={onBack}>
          Use a passkey instead
        </Button>
      </div>
    </form>
  )
}

function CodeStep({
  email,
  onSignedIn,
  onBack,
}: {
  email: string
  onSignedIn: () => void
  onBack: () => void
}) {
  const [otp, setOtp] = useState("")
  const verify = useMutation({
    mutationFn: (code: string) =>
      unwrap(authClient.signIn.emailOtp({ email, otp: code })),
    onSuccess: onSignedIn,
    onError: () => setOtp(""),
    meta: { silent: true },
  })
  const resend = useMutation({
    mutationFn: () =>
      unwrap(
        authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
      ),
    onSuccess: () => verify.reset(),
  })

  return (
    <AuthLayout
      title="Check your email"
      description={
        <>
          If <span className="font-medium text-foreground">{email}</span> is an
          admin here, a 6-digit code is on its way. It expires in 5 minutes.
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field data-invalid={verify.isError || undefined}>
          <FieldLabel htmlFor="otp" className="sr-only">
            Code
          </FieldLabel>
          <InputOTP
            id="otp"
            maxLength={6}
            pattern={REGEXP_ONLY_DIGITS}
            value={otp}
            onChange={setOtp}
            onComplete={(code: string) => verify.mutate(code)}
            autoFocus
            containerClassName="justify-start"
          >
            <InputOTPGroup>
              {Array.from({ length: 6 }, (_, index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  className="size-12 text-lg"
                  aria-invalid={verify.isError || undefined}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {verify.error && <FieldError>{verify.error.message}</FieldError>}
        </Field>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {verify.isPending ? (
            <span className="inline-flex items-center gap-2">
              <Spinner /> Signing in
            </span>
          ) : (
            <>
              <button
                type="button"
                className="underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                onClick={() => resend.mutate()}
                disabled={resend.isPending}
              >
                {resend.isSuccess ? "New code sent" : "Send a new code"}
              </button>
              <button
                type="button"
                className="underline-offset-4 hover:text-foreground hover:underline"
                onClick={onBack}
              >
                Use a different email
              </button>
            </>
          )}
        </div>
      </div>
    </AuthLayout>
  )
}
