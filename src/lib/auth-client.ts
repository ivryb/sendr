import { passkeyClient } from "@better-auth/passkey/client"
import { emailOTPClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  plugins: [emailOTPClient(), passkeyClient()],
})

const FRIENDLY_ERRORS: Record<string, string> = {
  AUTH_CANCELLED: "No passkey was used. Try again, or email yourself a code.",
  ERROR_CEREMONY_ABORTED: "Passkey setup was cancelled.",
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED:
    "This device already has a passkey for Sendr.",
  PASSKEY_NOT_FOUND:
    "This passkey isn't registered here anymore. Email yourself a code instead.",
  INVALID_OTP: "That code isn't right. Check the email and try again.",
  OTP_EXPIRED: "That code expired. Send yourself a new one.",
  TOO_MANY_ATTEMPTS: "Too many tries. Send yourself a new code.",
}

type AuthResult = {
  error: { code?: string; message?: string } | null
}

/** Better Auth returns errors instead of throwing; this throws them with readable copy. */
export async function unwrap<R extends AuthResult>(call: Promise<R>) {
  const result = await call
  const { error } = result
  if (error) {
    throw new Error(
      (error.code && FRIENDLY_ERRORS[error.code]) ||
        error.message ||
        "Something went wrong. Try again."
    )
  }
  return result
}

/** A label like "Mac" or "iPhone", so admins can tell their passkeys apart. */
export function deviceName() {
  const agent = navigator.userAgent
  const devices: [RegExp, string][] = [
    [/iPhone/, "iPhone"],
    [/iPad/, "iPad"],
    [/Android/, "Android"],
    [/Mac OS X/, "Mac"],
    [/Windows/, "Windows"],
    [/Linux/, "Linux"],
  ]
  return devices.find(([pattern]) => pattern.test(agent))?.[1] ?? "This device"
}
