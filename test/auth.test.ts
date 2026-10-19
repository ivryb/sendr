import { describe, expect, it } from "vitest"

import { claim, request, sentEmails, sessionCookie } from "./helpers"

describe("claiming an instance", () => {
  it("a new instance reports itself unclaimed", async () => {
    const response = await request("/api/setup")
    expect(await response.json()).toEqual({ claimed: false })
  })

  it("the setup code creates the first admin and signs them in", async () => {
    const response = await claim({ email: "Owner@Example.com" })
    expect(response.status).toBe(200)

    const session = await request("/api/auth/get-session", {
      cookie: sessionCookie(response),
    })
    expect((await session.json<{ user: { email: string } }>()).user.email).toBe(
      "owner@example.com"
    )
    expect(await (await request("/api/setup")).json()).toEqual({ claimed: true })
  })

  it("a wrong setup code is rejected", async () => {
    const response = await claim({ setupCode: "guess" })
    expect(response.status).toBe(403)
    expect(await (await request("/api/setup")).json()).toEqual({ claimed: false })
  })

  it("a setup code works only once", async () => {
    await claim()
    const second = await claim({ email: "intruder@example.com" })
    expect(second.status).toBe(403)
  })
})

describe("signing in with an emailed code", () => {
  it("an admin can sign in with a code sent to their email", async () => {
    await claim()
    await request("/api/auth/email-otp/send-verification-otp", {
      json: { email: "owner@example.com", type: "sign-in" },
    })
    const code = sentEmails().at(-1)?.text.match(/\d{6}/)?.[0]
    expect(code).toBeDefined()

    const response = await request("/api/auth/sign-in/email-otp", {
      json: { email: "owner@example.com", otp: code },
    })
    expect(response.status).toBe(200)
  })

  it("a code can't create an account for an unknown email", async () => {
    await claim()
    const before = sentEmails().length
    await request("/api/auth/email-otp/send-verification-otp", {
      json: { email: "stranger@example.com", type: "sign-in" },
    })
    expect(sentEmails().length).toBe(before)
  })
})
