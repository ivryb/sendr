import { exports } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"

import type { Email } from "../shared/model"
import { fakeAws } from "./fake-aws"
import {
  addSender,
  createApiKey,
  messageIdTo,
  permanentBounce,
  postSesEvent,
  request,
  sentEmails,
  sesEvent,
  signInAsAdmin,
} from "./helpers"

let admin: string

beforeEach(async () => {
  admin = await signInAsAdmin()
})

const sendEmail = (key: string, body: Record<string, unknown>) =>
  request("/api/v1/emails", {
    bearer: key,
    json: {
      from: "evan@example.com",
      to: "ann@example.com",
      subject: "Welcome",
      ...body,
    },
  })

describe("access levels", () => {
  it("a contacts key syncs contacts and nothing else", async () => {
    const key = await createApiKey(admin, ["contacts"])
    const upsert = await request("/api/v1/contacts/u1", {
      method: "PUT",
      bearer: key,
      json: { email: "ann@example.com" },
    })
    expect(upsert.status).toBe(200)
    expect(
      (await request("/api/v1/campaigns", { bearer: key, json: {} })).status
    ).toBe(403)
    expect((await sendEmail(key, { markdown: "Hi" })).status).toBe(403)
  })

  it("an emails key sends emails but can't touch contacts", async () => {
    await addSender(admin)
    const key = await createApiKey(admin, ["emails"])
    expect((await sendEmail(key, { markdown: "Hi" })).status).toBe(200)
    const upsert = await request("/api/v1/contacts/u1", {
      method: "PUT",
      bearer: key,
      json: { email: "ann@example.com" },
    })
    expect(upsert.status).toBe(403)
  })

  it("a full key runs a campaign end to end, but can't mint more keys", async () => {
    await addSender(admin)
    const key = await createApiKey(admin, ["full"])
    await request("/api/v1/contacts/u1", {
      method: "PUT",
      bearer: key,
      json: { email: "ann@example.com" },
    })
    const created = await request("/api/v1/campaigns", {
      bearer: key,
      json: { subject: "News", markdown: "Hello" },
    })
    const { campaign } = await created.json<{ campaign: { id: string } }>()
    const test = await request(`/api/v1/campaigns/${campaign.id}/test`, {
      bearer: key,
      json: { to: "agent-owner@example.com" },
    })
    expect(test.status).toBe(200)
    const started = await request(`/api/v1/campaigns/${campaign.id}/start`, {
      bearer: key,
      json: {},
    })
    expect(await started.json()).toMatchObject({
      campaign: { status: "first_batch" },
    })

    const minted = await request("/api/v1/api-keys", {
      bearer: key,
      json: { name: "another", permissions: ["full"] },
    })
    expect(minted.status).toBe(403)
  })

  it("a test send through the API says who gets it", async () => {
    await addSender(admin)
    const key = await createApiKey(admin, ["full"])
    const created = await request("/api/v1/campaigns", {
      bearer: key,
      json: { subject: "News", markdown: "Hi" },
    })
    const { campaign } = await created.json<{ campaign: { id: string } }>()
    const response = await request(`/api/v1/campaigns/${campaign.id}/test`, {
      bearer: key,
      json: {},
    })
    expect(response.status).toBe(400)
  })

  it("the docs are public and use this instance's address", async () => {
    const response = await request("/api/v1/docs")
    expect(response.headers.get("content-type")).toContain("text/markdown")
    expect(await response.text()).toContain(
      "https://sendr.test/api/v1/contacts/user_123"
    )
  })
})

describe("single emails", () => {
  let key: string

  beforeEach(async () => {
    await addSender(admin)
    key = await createApiKey(admin, ["emails"])
  })

  it("sends from a sender without the campaign footer or unsubscribe link", async () => {
    const response = await sendEmail(key, {
      markdown: "Thanks for **signing up**.",
    })
    const { email } = await response.json<{ email: Email }>()
    expect(email).toMatchObject({
      status: "sent",
      recipients: [{ email: "ann@example.com", field: "to", status: "sent" }],
    })

    const sent = sentEmails().at(-1)!
    expect(sent.from).toBe('"Evan" <evan@example.com>')
    expect(sent.html).toContain("<strong>signing up</strong>")
    expect(sent.html).not.toContain("Unsubscribe")
    expect(sent.headers).toBeUndefined()
  })

  it("won't send from a sender that isn't verified", async () => {
    fakeAws.verified = false
    await addSender(admin, { email: "news@other.example" })
    const response = await sendEmail(key, {
      from: "news@other.example",
      markdown: "Hi",
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: "sender_not_ready" })
  })

  it("tracks the delivery report, and refuses an address once it bounced", async () => {
    const { email } = await (
      await sendEmail(key, { markdown: "Hi" })
    ).json<{ email: Email }>()
    await postSesEvent(permanentBounce(messageIdTo("ann@example.com")))

    const status = await request(`/api/v1/emails/${email.id}`, { bearer: key })
    expect(await status.json()).toMatchObject({
      email: { recipients: [{ email: "ann@example.com", status: "bounced" }] },
    })
    const again = await sendEmail(key, { markdown: "Hi again" })
    expect(again.status).toBe(422)
    expect(await again.json()).toMatchObject({ error: "suppressed" })
  })

  it("sends one email to several people and copies, and tracks each one's report", async () => {
    const { email } = await (
      await sendEmail(key, {
        to: ["ann@example.com", "Bob@Example.com"],
        cc: ["ops@example.com", "ann@example.com"],
        markdown: "Your export failed.",
      })
    ).json<{ email: Email }>()
    expect(sentEmails().at(-1)).toMatchObject({
      to: ["ann@example.com", "bob@example.com"],
      cc: ["ops@example.com"],
    })

    const id = messageIdTo("bob@example.com")
    await postSesEvent(sesEvent("Delivery", id, { recipients: ["ann@example.com", "ops@example.com"] }))
    await postSesEvent(permanentBounce(id, ["bob@example.com"]))
    const status = await request(`/api/v1/emails/${email.id}`, { bearer: key })
    expect((await status.json<{ email: Email }>()).email.recipients).toEqual([
      { email: "ann@example.com", field: "to", status: "delivered" },
      { email: "bob@example.com", field: "to", status: "bounced" },
      { email: "ops@example.com", field: "cc", status: "delivered" },
    ])

    const again = await sendEmail(key, { cc: ["bob@example.com"], markdown: "Hi" })
    expect(again.status).toBe(422)
    expect(await again.json()).toMatchObject({
      error: "suppressed",
      message: expect.stringContaining("bob@example.com"),
    })
  })

  it("sends once for a repeated Idempotency-Key, and answers the repeat with the first email", async () => {
    const send = (idempotencyKey: string) =>
      request("/api/v1/emails", {
        bearer: key,
        headers: { "Idempotency-Key": idempotencyKey },
        json: { from: "evan@example.com", to: "ann@example.com", subject: "Ready", markdown: "Hi" },
      })
    const first = await (await send("export-1-ready")).json<{ email: Email }>()
    const repeat = await (await send("export-1-ready")).json<{ email: Email }>()
    expect(repeat.email.id).toBe(first.email.id)
    expect(sentEmails().filter((sent) => sent.subject === "Ready")).toHaveLength(1)

    await send("export-2-ready")
    expect(sentEmails().filter((sent) => sent.subject === "Ready")).toHaveLength(2)
  })

  it("sends to as many people as one email can have, and refuses more", async () => {
    const readers = Array.from({ length: 51 }, (_, i) => `reader${i}@example.com`)
    const full = await sendEmail(key, { to: readers.slice(0, 40), cc: readers.slice(40, 50), markdown: "Hi" })
    const { email } = await full.json<{ email: Email }>()
    expect(email.recipients).toHaveLength(50)
    expect((await sendEmail(key, { to: readers, markdown: "Hi" })).status).toBe(400)
  })

  it("needs a message", async () => {
    expect((await sendEmail(key, {})).status).toBe(400)
  })
})

describe("safety", () => {
  it("refuses form posts from another site that ride the admin's session", async () => {
    // Built by hand: the request helper always sends this instance's own origin.
    const response = await exports.default.fetch(
      new Request("https://sendr.test/api/v1/campaigns", {
        method: "POST",
        headers: {
          cookie: admin,
          origin: "https://evil.example",
          "content-type": "text/plain",
        },
        body: "{}",
      })
    )
    expect(response.status).toBe(403)
  })

  it("an Authorization header that isn't a Bearer key doesn't skip that check", async () => {
    const response = await exports.default.fetch(
      new Request("https://sendr.test/api/v1/settings", {
        method: "PUT",
        headers: {
          cookie: admin,
          origin: "https://evil.example",
          "content-type": "text/plain",
          authorization: "Basic YWRtaW46YWRtaW4=",
        },
        body: JSON.stringify({ footer: "Hacked" }),
      })
    )
    expect(response.status).toBe(403)
    const settings = await request("/api/v1/settings", { cookie: admin })
    expect(await settings.json()).toMatchObject({ footer: "" })
  })

  it("refuses an Authorization header that isn't a Bearer key, even with a session", async () => {
    const response = await request("/api/v1/me", {
      cookie: admin,
      headers: { authorization: "Basic YWRtaW46YWRtaW4=" },
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: "invalid_api_key" })
  })

  it("an app's server can call with its key and no Origin or content type, as curl does", async () => {
    const key = await createApiKey(admin, ["contacts"])
    const response = await exports.default.fetch(
      new Request("https://sendr.test/api/v1/contacts/u1", {
        method: "DELETE",
        headers: { authorization: `Bearer ${key}` },
      })
    )
    expect(response.status).toBe(200)
  })

  it("answers a bad query with 400, not a crash", async () => {
    const key = await createApiKey(admin, ["contacts"])
    const response = await request("/api/v1/contacts?limit=0", { bearer: key })
    expect(response.status).toBe(400)
  })

  it("a deleted user who unsubscribed stays unsubscribed when added back", async () => {
    const key = await createApiKey(admin, ["contacts"])
    const put = (externalId: string, body: Record<string, unknown>) =>
      request(`/api/v1/contacts/${externalId}`, {
        method: "PUT",
        bearer: key,
        json: body,
      })
    await put("u1", { email: "ann@example.com", unsubscribed: true })
    await request("/api/v1/contacts/u1", { method: "DELETE", bearer: key })
    await put("u2", { email: "ann@example.com" })

    const list = await request("/api/v1/contacts", { bearer: key })
    const { contacts } = await list.json<{
      contacts: { externalId: string; status: string }[]
    }>()
    expect(contacts).toEqual([
      expect.objectContaining({ externalId: "u2", status: "unsubscribed" }),
    ])
  })

  it("finds a sender by address whatever its case", async () => {
    await addSender(admin, { email: "Hello@Example.com" })
    const key = await createApiKey(admin, ["emails"])
    const response = await sendEmail(key, {
      from: "hello@example.com",
      markdown: "Hi",
    })
    expect(response.status).toBe(200)
  })
})

describe("combined permissions", () => {
  it("one key can sync contacts and send emails, without full access", async () => {
    await addSender(admin)
    const key = await createApiKey(admin, ["contacts", "emails"])
    const upsert = await request("/api/v1/contacts/u1", {
      method: "PUT",
      bearer: key,
      json: { email: "bob@example.com" },
    })
    expect(upsert.status).toBe(200)
    expect((await sendEmail(key, { markdown: "Hi" })).status).toBe(200)
    expect((await request("/api/v1/campaigns", { bearer: key })).status).toBe(
      403
    )
  })

  it("a key needs at least one permission", async () => {
    const response = await request("/api/v1/api-keys", {
      cookie: admin,
      json: { name: "empty", permissions: [] },
    })
    expect(response.status).toBe(400)
  })
})
