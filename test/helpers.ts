import { exports } from "cloudflare:workers"

import { memoryOutbox } from "../worker/email/providers"

export const ORIGIN = "https://sendr.test"
export const SETUP_CODE = "test-setup-code"

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

export function claim(
  body: Partial<{ setupCode: string; email: string; name: string }> = {}
) {
  return request("/api/auth/setup/claim", {
    json: {
      setupCode: SETUP_CODE,
      email: "owner@example.com",
      name: "Owner",
      ...body,
    },
  })
}

/** Claims the instance and returns the admin's session cookie. */
export async function signInAsAdmin() {
  const response = await claim()
  if (!response.ok) throw new Error(`claim failed: ${await response.text()}`)
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
