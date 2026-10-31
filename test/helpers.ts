import { env } from "cloudflare:test"
import { exports } from "cloudflare:workers"

import type { ApiKeyPermission, Sender } from "../shared/model"
import { memoryOutbox } from "../worker/email/providers"
import { TOPIC_ARN } from "./fake-aws"

export const ORIGIN = "https://sendr.test"
export const ADMIN_EMAIL = "owner@example.com"

/** Codes the instance handed to sendr.soy; test/setup.ts intercepts those requests. */
export const relayedCodes: { email: string; code: string }[] = []

export function request(
  path: string,
  init: RequestInit & { json?: unknown; cookie?: string; bearer?: string } = {}
) {
  const { json, cookie, bearer, ...rest } = init
  const headers = new Headers(rest.headers)
  headers.set("origin", ORIGIN)
  if (json !== undefined) headers.set("content-type", "application/json")
  if (cookie) headers.set("cookie", cookie)
  if (bearer) headers.set("authorization", `Bearer ${bearer}`)
  return exports.default.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: json !== undefined ? "POST" : "GET",
      ...rest,
      headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  )
}

export function requestLoginCode(email: string) {
  return request("/api/auth/email-otp/send-verification-otp", {
    json: { email, type: "sign-in" },
  })
}

export function signInWithCode(email: string, otp: string) {
  return request("/api/auth/sign-in/email-otp", { json: { email, otp } })
}

/** The most recent login code, whether the instance sent it or sendr.soy did. */
export function lastLoginCode(email: string) {
  const sent = sentEmails()
    .filter((message) => message.to.includes(email))
    .map((message) => message.text.match(/\d{6}/)?.[0])
  const relayed = relayedCodes.filter((entry) => entry.email === email).map((entry) => entry.code)
  return [...sent, ...relayed].at(-1)
}

/** Signs in as ADMIN_EMAIL (creating the admin on a fresh instance) and returns the session cookie. */
export async function signInAsAdmin() {
  await requestLoginCode(ADMIN_EMAIL)
  const response = await signInWithCode(ADMIN_EMAIL, lastLoginCode(ADMIN_EMAIL) ?? "")
  if (!response.ok) throw new Error(`sign-in failed: ${await response.text()}`)
  return sessionCookie(response)
}

export function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
}

export function sentEmails() {
  return memoryOutbox
}

export const SENDER = {
  name: "Evan",
  email: "evan@example.com",
  region: "us-east-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
}

/** Connects a sender through the API, against the fake AWS in test/fake-aws.ts. */
export async function addSender(cookie: string, input: Partial<typeof SENDER> = {}) {
  const response = await request("/api/v1/senders", { cookie, json: { ...SENDER, ...input } })
  if (!response.ok) throw new Error(`adding a sender failed: ${await response.text()}`)
  const { sender } = await response.json<{ sender: Sender }>()
  // Verification is read on check, as the sender page does.
  await request(`/api/v1/senders/${sender.id}`, { cookie })
  return sender
}

export async function webhookSecret() {
  const row = await env.DB.prepare("SELECT webhook_secret AS secret FROM settings").first<{
    secret: string
  }>()
  return row!.secret
}

/** Posts an SES event the way SNS delivers it. */
export async function postSesEvent(event: unknown, secret?: string) {
  return request(`/hooks/ses/${secret ?? (await webhookSecret())}`, {
    json: { Type: "Notification", TopicArn: TOPIC_ARN, Message: JSON.stringify(event) },
  })
}

/** The provider's ID for the latest email to `email`, as SES events carry it. */
export function messageIdTo(email: string) {
  return sentEmails().findLast((sent) => sent.to.includes(email))!.providerMessageId
}

/**
 * An SES event about the email with `messageId`, for `recipients` (by default, everyone it
 * went to). `details` go into the event's own part, such as a bounce's `bounceType`.
 */
export function sesEvent(
  eventType: "Delivery" | "Bounce" | "Complaint",
  messageId: string,
  { recipients, ...details }: { recipients?: string[]; [detail: string]: unknown } = {}
) {
  const sent = sentEmails().find((email) => email.providerMessageId === messageId)
  const addresses = recipients ?? [...(sent?.to ?? []), ...(sent?.cc ?? [])]
  const listed = addresses.map((emailAddress) => ({ emailAddress }))
  const report = {
    Delivery: { delivery: { recipients: addresses, ...details } },
    Bounce: { bounce: { bouncedRecipients: listed, ...details } },
    Complaint: { complaint: { complainedRecipients: listed, ...details } },
  }[eventType]
  return { eventType, mail: { messageId }, ...report }
}

export function permanentBounce(messageId: string, recipients?: string[]) {
  return sesEvent("Bounce", messageId, { bounceType: "Permanent", recipients })
}

/** Creates an API key as the signed-in admin and returns its secret. */
export async function createApiKey(
  cookie: string,
  permissions: ApiKeyPermission[] = ["contacts"]
) {
  const response = await request("/api/v1/api-keys", {
    cookie,
    json: { name: permissions.join("+"), permissions },
  })
  return (await response.json<{ key: string }>()).key
}
