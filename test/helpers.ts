import { env } from "cloudflare:test"
import { exports } from "cloudflare:workers"

import type { ApiKeyAccess, Sender } from "../shared/model"
import { memoryOutbox } from "../worker/email/providers"

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
    .filter((message) => message.to === email)
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

/** Creates an API key as the signed-in admin and returns its secret. */
export async function createApiKey(cookie: string, access: ApiKeyAccess = "contacts") {
  const response = await request("/api/v1/api-keys", { cookie, json: { name: access, access } })
  return (await response.json<{ key: string }>()).key
}
