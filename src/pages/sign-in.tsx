import { useState, type FormEvent } from "react"
import { useMutation } from "@tanstack/react-query"
import { FingerprintIcon, MailIcon } from "lucide-react"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import { redirect, useNavigate } from "react-router"

import type { Route } from "./+types/sign-in"
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
import { api } from "@/lib/api"
import { authClient, unwrap } from "@/lib/auth-client"
import { useAddPasskey } from "@/lib/passkeys"
import { getAdmin, isClaimed } from "../../worker/auth"

export async function loader({ request, url }: Route.LoaderArgs) {
  const next = safeNext(url.searchParams.get("next"), url)
  if (await getAdmin(request)) throw redirect(next)
  // Nobody has signed in yet, so there are no passkeys to offer.
  return { firstSignIn: !(await isClaimed()), next }
}

/**
 * Only pages on this site, so a crafted link can't send the admin elsewhere. Resolving the
 * URL first catches tricks browsers read as `//evil.com`, like `/\\evil.com` or `/.//evil.com`.
 */
function safeNext(next: string | null, here: URL) {
  const target = new URL(next ?? "/campaigns", here)
  const path = target.pathname + target.search
  return target.origin === here.origin && !path.startsWith("//")
    ? path
    : "/campaigns"
}

type Step =
  | { name: "choose" }
  | { name: "email" }
  | { name: "code"; email: string }
  | { name: "passkey" }

export default function SignInPage({ loaderData }: Route.ComponentProps) {
  const { firstSignIn, next } = loaderData
  const [step, setStep] = useState<Step>(
    firstSignIn ? { name: "email" } : { name: "choose" }
  )
  const navigate = useNavigate()
  const signedIn = () => navigate(next, { replace: true })
  // Admins who sign in with a code are offered a passkey until they have one.
  const signedInWithCode = async () => {
    // The code is spent by now, so a failed lookup must still let the admin in.
    const passkeys = await api<unknown[]>(
      "/api/auth/passkey/list-user-passkeys"
    ).catch(() => null)
    if (passkeys?.length === 0) setStep({ name: "passkey" })
    else await signedIn()
  }

  if (step.name === "code") {
    return (
      <CodeStep
        email={step.email}
        onSignedIn={signedInWithCode}
        onBack={() => setStep({ name: "email" })}
      />
    )
  }
  if (step.name === "passkey") return <PasskeyStep onDone={signedIn} />
  return (
    <AuthLayout
      title={firstSignIn ? "Welcome to Sendr" : "Sign in"}
      description={
        firstSignIn
          ? "Sign in with the email you entered when you deployed Sendr. We'll send you a code."
          : "Use a passkey, or get a sign-in code by email."
      }
    >
      {step.name === "choose" ? (
        <ChooseStep
          onSignedIn={signedIn}
          onEmail={() => setStep({ name: "email" })}
        />
      ) : (
        <EmailStep
          onSent={(email) => setStep({ name: "code", email })}
          onBack={firstSignIn ? undefined : () => setStep({ name: "choose" })}
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
  onBack?: () => void
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
        {onBack && (
          <Button type="button" variant="ghost" size="lg" onClick={onBack}>
            Use a passkey instead
          </Button>
        )}
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

function PasskeyStep({ onDone }: { onDone: () => void }) {
  const addPasskey = useAddPasskey({ onAdded: onDone })
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
        <Button variant="ghost" size="lg" onClick={onDone}>
          Skip for now
        </Button>
      </div>
    </AuthLayout>
  )
}
