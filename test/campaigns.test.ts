import { createMessageBatch, env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Campaign } from "../shared/model"
import worker from "../worker"
import { request, sentEmails, signInAsAdmin } from "./helpers"

let admin: string
let apiKey: string

beforeEach(async () => {
  admin = await signInAsAdmin()
  await request("/api/admin/settings", {
    method: "PUT",
    cookie: admin,
    json: {
      fromName: "Evan",
      fromEmail: "evan@example.com",
      footer: "Example Inc, 1 Main St",
    },
  })
  const created = await request("/api/admin/api-keys", {
    cookie: admin,
    json: { name: "test" },
  })
  apiKey = (await created.json<{ key: string }>()).key
})

async function addContacts(count: number) {
  await request("/api/v1/contacts/batch", {
    bearer: apiKey,
    json: {
      contacts: Array.from({ length: count }, (_, i) => ({
        externalId: `u${i}`,
        email: `reader${i}@example.com`,
        firstName: i === 0 ? "Ann" : undefined,
      })),
    },
  })
}

async function newCampaign(body: Record<string, unknown> = {}) {
  const response = await request("/api/admin/campaigns", {
    cookie: admin,
    json: { subject: "News for {{first_name|you}}", markdown: "Hey {{first_name|there}}!", ...body },
  })
  return (await response.json<{ campaign: Campaign }>()).campaign
}

async function act(id: string, action: "start" | "approve" | "cancel") {
  return request(`/api/admin/campaigns/${id}/${action}`, { cookie: admin, json: {} })
}

async function campaign(id: string) {
  const response = await request(`/api/admin/campaigns/${id}`, { cookie: admin })
  return (await response.json<{ campaign: Campaign }>()).campaign
}

const reachStatus = (id: string, status: Campaign["status"]) =>
  vi.waitUntil(async () => (await campaign(id)).status === status, {
    timeout: 10_000,
    interval: 50,
  })

describe("sending a campaign", () => {
  it("sends the first batch, then waits for approval", async () => {
    await addContacts(5)
    const { id } = await newCampaign({ firstBatchSize: 2 })

    expect((await act(id, "start")).status).toBe(200)
    await reachStatus(id, "awaiting_approval")

    expect(sentEmails()).toHaveLength(2)
    expect((await campaign(id)).counts).toMatchObject({ total: 5, sent: 2, queued: 3 })
  })

  it("approving sends to everyone else exactly once", async () => {
    await addContacts(5)
    const { id } = await newCampaign({ firstBatchSize: 2 })
    await act(id, "start")
    await reachStatus(id, "awaiting_approval")

    await act(id, "approve")
    await reachStatus(id, "sent")

    const recipients = sentEmails().map((email) => email.to)
    expect(recipients).toHaveLength(5)
    expect(new Set(recipients).size).toBe(5)
    expect((await campaign(id)).counts).toMatchObject({ total: 5, sent: 5, queued: 0 })
  })

  it("a list smaller than the first batch is sent completely without approval", async () => {
    await addContacts(2)
    const { id } = await newCampaign({ firstBatchSize: 10 })
    await act(id, "start")
    await reachStatus(id, "sent")
    expect(sentEmails()).toHaveLength(2)
  })

  it("personalizes each email and adds one-click unsubscribe", async () => {
    await addContacts(2)
    const { id } = await newCampaign()
    await act(id, "start")
    await reachStatus(id, "sent")

    const ann = sentEmails().find((email) => email.to === "reader0@example.com")!
    const other = sentEmails().find((email) => email.to === "reader1@example.com")!
    expect(ann.subject).toBe("News for Ann")
    expect(ann.text).toContain("Hey Ann!")
    expect(other.text).toContain("Hey there!")
    expect(ann.from).toBe("Evan <evan@example.com>")
    expect(ann.html).toContain("Example Inc, 1 Main St")
    expect(ann.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
    expect(ann.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/sendr\.test\/u\/.+>$/)
  })

  it("skips contacts who unsubscribed after the campaign started", async () => {
    await addContacts(3)
    const { id } = await newCampaign({ firstBatchSize: 1 })
    await act(id, "start")
    await reachStatus(id, "awaiting_approval")

    await request("/api/v1/contacts/u2", {
      method: "PUT",
      bearer: apiKey,
      json: { email: "reader2@example.com", unsubscribed: true },
    })
    await act(id, "approve")
    await reachStatus(id, "sent")

    expect(sentEmails().map((email) => email.to)).not.toContain("reader2@example.com")
    expect((await campaign(id)).counts).toMatchObject({ sent: 2, skipped: 1 })
  })

  it("cancelling stops the rest from being sent", async () => {
    await addContacts(4)
    const { id } = await newCampaign({ firstBatchSize: 1 })
    await act(id, "start")
    await reachStatus(id, "awaiting_approval")

    expect((await act(id, "cancel")).status).toBe(200)
    expect((await act(id, "approve")).status).toBe(409)
    expect(sentEmails()).toHaveLength(1)
  })

  it("can't start twice or start without a sender", async () => {
    await addContacts(1)
    const { id } = await newCampaign()
    await act(id, "start")
    expect((await act(id, "start")).status).toBe(409)

    await request("/api/admin/settings", {
      method: "PUT",
      cookie: admin,
      json: { fromEmail: "" },
    })
    const draft = await newCampaign()
    const response = await act(draft.id, "start")
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "not_ready" })
  })

  it("only drafts can be edited", async () => {
    await addContacts(1)
    const { id } = await newCampaign()
    await act(id, "start")
    const response = await request(`/api/admin/campaigns/${id}`, {
      method: "PUT",
      cookie: admin,
      json: { subject: "Changed" },
    })
    expect(response.status).toBe(409)
  })

  it("a test send goes only to the admin and doesn't count as a delivery", async () => {
    await addContacts(2)
    const { id } = await newCampaign()
    await request(`/api/admin/campaigns/${id}/test`, { cookie: admin, json: {} })

    expect(sentEmails()).toMatchObject([
      { to: "owner@example.com", subject: "[Test] News for Owner" },
    ])
    expect((await campaign(id)).counts.total).toBe(0)
  })

  it("a redelivered queue message never sends twice", async () => {
    await addContacts(3)
    const { id } = await newCampaign()
    await act(id, "start")
    await reachStatus(id, "sent")

    const { results } = await env.DB.prepare(
      "SELECT id FROM deliveries WHERE campaign_id = ?"
    )
      .bind(id)
      .all<{ id: string }>()
    const batch = createMessageBatch("sendr-send", [
      {
        id: "redelivery",
        timestamp: new Date(),
        attempts: 2,
        body: { campaignId: id, deliveryIds: results.map((row) => row.id) },
      },
    ])
    await worker.queue(batch)

    expect(sentEmails()).toHaveLength(3)
  })
})
