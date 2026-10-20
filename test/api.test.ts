import { env } from "cloudflare:test"
import { exports } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"

import type { Email } from "../shared/model"
import { fakeAws, TOPIC_ARN } from "./fake-aws"
import {
  addSender,
  createApiKey,
  request,
  sentEmails,
  signInAsAdmin,
  webhookSecret,
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
    expect(email).toMatchObject({ to: "ann@example.com", status: "sent" })

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
    const row = await env.DB.prepare(
      "SELECT provider_message_id AS id FROM emails WHERE id = ?"
    )
      .bind(email.id)
      .first<{ id: string }>()
    await request(`/hooks/ses/${await webhookSecret()}`, {
      json: {
        Type: "Notification",
        TopicArn: TOPIC_ARN,
        Message: JSON.stringify({
          eventType: "Bounce",
          mail: { messageId: row!.id },
          bounce: { bounceType: "Permanent" },
        }),
      },
    })

    const status = await request(`/api/v1/emails/${email.id}`, { bearer: key })
    expect(await status.json()).toMatchObject({ email: { status: "bounced" } })
    const again = await sendEmail(key, { markdown: "Hi again" })
    expect(again.status).toBe(422)
    expect(await again.json()).toMatchObject({ error: "suppressed" })
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
