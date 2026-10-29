import { env } from "cloudflare:test"
import { describe, expect, it, onTestFinished } from "vitest"

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

  it("a code sent before ADMIN_EMAIL changed can't create an admin", async () => {
    await requestLoginCode(ADMIN_EMAIL)
    // The deployer moves ADMIN_EMAIL elsewhere; the old address still holds a valid code.
    env.ADMIN_EMAIL = "new-owner@example.com"
    onTestFinished(() => void (env.ADMIN_EMAIL = ADMIN_EMAIL))

    const response = await signInWithCode(ADMIN_EMAIL, relayedCodes[0].code)
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
  it("an address gets 5 codes an hour, then a refusal and no new code", async () => {
    for (let i = 0; i < 5; i++) expect((await requestLoginCode(ADMIN_EMAIL)).status).toBe(200)

    const refused = await requestLoginCode("Owner@Example.com")
    expect(refused.status).toBe(429)
    expect((await refused.json<{ message: string }>()).message).toMatch(
      /^Too many codes for this email\. Try again in \d+ minutes?\.$/
    )
    expect(relayedCodes).toHaveLength(5)
    // The last code still works, so a refusal never locks out whoever has it.
    expect((await signInWithCode(ADMIN_EMAIL, relayedCodes[4].code)).status).toBe(200)
  })

  it("counts each address on its own", async () => {
    for (let i = 0; i < 6; i++) await requestLoginCode("intruder@example.com")
    expect((await requestLoginCode(ADMIN_EMAIL)).status).toBe(200)
  })
})

describe("guessing a code", () => {
  const email = ADMIN_EMAIL

  it("40 guesses at once, the right one among them, can't tell which is right", async () => {
    const admin = await signInAsAdmin()
    await requestLoginCode(email)
    const code = lastLoginCode(email)!
    const wrong = (i: number) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, "0")
    const guesses = Array.from({ length: 40 }, (_, i) => (i === 20 ? code : wrong(i)))

    // Only sign-in compares codes, and it spends a guess on each; this endpoint would compare
    // without counting guesses that arrive together, and answer the right one differently.
    const answers = await Promise.all(
      guesses.map(async (otp) => {
        const json = { email, type: "sign-in", otp }
        const response = await request("/api/auth/email-otp/check-verification-otp", { json, cookie: admin })
        return response.status
      })
    )
    expect(new Set(answers)).toEqual(new Set([404]))
    expect((await signInWithCode(email, code)).status).toBe(200)
  })

  it("no other endpoint takes or sends a code", async () => {
    const admin = await signInAsAdmin()
    await requestLoginCode(email)
    const otp = lastLoginCode(email)!
    const newEmail = "new@example.com"
    const calls = [
      ["/email-otp/verify-email", { email, otp }],
      ["/email-otp/request-password-reset", { email }],
      ["/forget-password/email-otp", { email }],
      ["/email-otp/reset-password", { email, otp, password: "a-new-password" }],
      ["/email-otp/request-email-change", { newEmail }],
      ["/email-otp/change-email", { newEmail, otp }],
    ] as const
    for (const [path, json] of calls) {
      const response = await request(`/api/auth${path}`, { json, cookie: admin })
      expect({ path, status: response.status }).toEqual({ path, status: 404 })
    }
    expect(relayedCodes).toHaveLength(2)
    expect((await signInWithCode(email, otp)).status).toBe(200)
  })
})
