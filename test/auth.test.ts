import { env } from "cloudflare:test"
import { describe, expect, it } from "vitest"

import {
  addSender,
  ADMIN_EMAIL,
  lastLoginCode,
  relayedCodes,
  request,
  requestLoginCode,
  sentEmails,
  sessionCookie,
  signInAsAdmin,
  signInWithCode,
} from "./helpers"

const claimed = async () => (await request("/api/setup")).json()

describe("first sign-in", () => {
  it("a new instance reports itself unclaimed", async () => {
    expect(await claimed()).toEqual({ claimed: false })
  })

  it("ADMIN_EMAIL gets a code through sendr.soy and becomes the first admin", async () => {
    await requestLoginCode("Owner@Example.com")
    expect(relayedCodes).toEqual([{ email: ADMIN_EMAIL, code: expect.stringMatching(/^\d{6}$/) }])

    const response = await signInWithCode(ADMIN_EMAIL, relayedCodes[0].code)
    expect(response.status).toBe(200)
    const session = await request("/api/auth/get-session", { cookie: sessionCookie(response) })
    expect((await session.json<{ user: { email: string } }>()).user.email).toBe(ADMIN_EMAIL)
    expect(await claimed()).toEqual({ claimed: true })
  })

  it("the first sign-in sets the public URL used in unsubscribe links", async () => {
    const admin = await signInAsAdmin()
    const settings = await request("/api/v1/settings", { cookie: admin })
    expect((await settings.json<{ publicUrl: string }>()).publicUrl).toBe("https://sendr.test")
  })

  it("any other email gets no code and can't become an admin", async () => {
    await requestLoginCode("intruder@example.com")
    expect(relayedCodes).toEqual([])
    expect(sentEmails()).toEqual([])

    const guess = await signInWithCode("intruder@example.com", "123456")
    expect(guess.ok).toBe(false)
    expect(await claimed()).toEqual({ claimed: false })
  })

  it("even a valid code for another email can't create an admin", async () => {
    await requestLoginCode("intruder@example.com")
    // Better Auth stores the unsent code; read it to play an attacker who guessed it.
    const stored = await env.DB.prepare("select value from verification where identifier = ?")
      .bind("sign-in-otp-intruder@example.com")
      .first<{ value: string }>()
    const code = stored!.value.split(":")[0]

    const response = await signInWithCode("intruder@example.com", code)
    expect(response.ok).toBe(false)
    expect(await claimed()).toEqual({ claimed: false })
  })
})

describe("signing in", () => {
  it("once the instance has a sender, codes come from it", async () => {
    const admin = await signInAsAdmin()
    await addSender(admin, { name: "Owner", email: "hello@example.com" })
    relayedCodes.length = 0

    await requestLoginCode(ADMIN_EMAIL)
    expect(relayedCodes).toEqual([])
    expect(sentEmails().at(-1)?.from).toBe('"Owner" <hello@example.com>')

    const response = await signInWithCode(ADMIN_EMAIL, lastLoginCode(ADMIN_EMAIL)!)
    expect(response.status).toBe(200)
  })

  it("a wrong code doesn't sign in", async () => {
    await signInAsAdmin()
    await requestLoginCode(ADMIN_EMAIL)
    const response = await signInWithCode(ADMIN_EMAIL, "000000")
    expect(response.ok).toBe(false)
  })
})

describe("login code limit", () => {
  const storedCode = async (email: string) =>
    (
      await env.DB.prepare("select value from verification where identifier = ?")
        .bind(`sign-in-otp-${email}`)
        .first<{ value: string }>()
    )?.value

  it("an address gets 5 codes an hour, then a refusal and no new code", async () => {
    for (let i = 0; i < 5; i++) expect((await requestLoginCode(ADMIN_EMAIL)).status).toBe(200)
    const code = await storedCode(ADMIN_EMAIL)

    const refused = await requestLoginCode("Owner@Example.com")
    expect(refused.status).toBe(429)
    expect((await refused.json<{ message: string }>()).message).toMatch(
      /^Too many codes for this email\. Try again in \d+ minutes?\.$/
    )
    expect(relayedCodes).toHaveLength(5)
    expect(await storedCode(ADMIN_EMAIL)).toBe(code)
    // The last code still works, so a refusal never locks out whoever has it.
    expect((await signInWithCode(ADMIN_EMAIL, relayedCodes[4].code)).status).toBe(200)
  })

  it("counts each address on its own", async () => {
    for (let i = 0; i < 6; i++) await requestLoginCode("intruder@example.com")
    expect((await requestLoginCode(ADMIN_EMAIL)).status).toBe(200)
  })

  it("password reset requests send no code", async () => {
    await signInAsAdmin()
    relayedCodes.length = 0
    await request("/api/auth/email-otp/request-password-reset", { json: { email: ADMIN_EMAIL } })
    await request("/api/auth/forget-password/email-otp", { json: { email: ADMIN_EMAIL } })
    expect(relayedCodes).toEqual([])
  })
})
