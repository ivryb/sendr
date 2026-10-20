import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Campaign, Contact } from "../shared/model"
import { TOPIC_ARN } from "./fake-aws"
import { addSender, request, sentEmails, signInAsAdmin, webhookSecret } from "./helpers"

let admin: string
let apiKey: string

beforeEach(async () => {
  admin = await signInAsAdmin()
  await addSender(admin)
  const created = await request("/api/admin/api-keys", { cookie: admin, json: { name: "t" } })
  apiKey = (await created.json<{ key: string }>()).key
  await request("/api/v1/contacts/batch", {
    bearer: apiKey,
    json: {
      contacts: [
        { externalId: "u1", email: "ann@example.com" },
        { externalId: "u2", email: "bob@example.com" },
      ],
    },
  })
})

async function sendCampaign() {
  const created = await request("/api/admin/campaigns", {
    cookie: admin,
    json: { subject: "Hello", markdown: "Body" },
  })
  const { campaign } = await created.json<{ campaign: Campaign }>()
  await request(`/api/admin/campaigns/${campaign.id}/start`, { cookie: admin, json: {} })
  await vi.waitUntil(async () => (await getCampaign(campaign.id)).status === "sent", {
    timeout: 10_000,
    interval: 50,
  })
  return campaign.id
}

async function getCampaign(id: string) {
  const response = await request(`/api/admin/campaigns/${id}`, { cookie: admin })
  return (await response.json<{ campaign: Campaign }>()).campaign
}

async function contactStatus(email: string) {
  const response = await request(`/api/admin/contacts?q=${email}`, { cookie: admin })
  return (await response.json<{ contacts: Contact[] }>()).contacts[0].status
}

/** Path of the unsubscribe link in the email sent to `email`. */
function unsubscribePath(email: string) {
  const header = sentEmails().find((sent) => sent.to === email)!.headers!["List-Unsubscribe"]
  return new URL(header.slice(1, -1)).pathname
}

describe("unsubscribing", () => {
  it("the unsubscribe page asks for confirmation instead of acting on a plain visit", async () => {
    await sendCampaign()
    const page = await request(unsubscribePath("ann@example.com"))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("Unsubscribe")
    expect(await contactStatus("ann@example.com")).toBe("subscribed")
  })

  it("one-click unsubscribe from the mail client removes the contact from the next campaign", async () => {
    await sendCampaign()
    const response = await request(unsubscribePath("ann@example.com"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    })
    expect(response.status).toBe(200)
    expect(await contactStatus("ann@example.com")).toBe("unsubscribed")

    sentEmails().length = 0
    await sendCampaign()
    expect(sentEmails().map((email) => email.to)).toEqual(["bob@example.com"])
  })

  it("the recipient can resubscribe from the same page", async () => {
    await sendCampaign()
    const path = unsubscribePath("ann@example.com")
    await request(path, { method: "POST" })
    await request(`${path}/resubscribe`, { method: "POST" })
    expect(await contactStatus("ann@example.com")).toBe("subscribed")
  })

  it("a forged or tampered link is rejected", async () => {
    await sendCampaign()
    const path = unsubscribePath("ann@example.com")
    expect((await request(`${path.slice(0, -2)}xx`, { method: "POST" })).status).toBe(404)
    expect((await request("/u/not-a-token", { method: "POST" })).status).toBe(404)
    expect(await contactStatus("ann@example.com")).toBe("subscribed")
  })
})

describe("provider events", () => {
  /** Posts an SES event the way SNS delivers it. */
  async function postSesEvent(event: unknown, secret?: string) {
    return request(`/hooks/ses/${secret ?? (await webhookSecret())}`, {
      json: { Type: "Notification", TopicArn: TOPIC_ARN, Message: JSON.stringify(event) },
    })
  }

  async function messageIdFor(campaignId: string, email: string) {
    // The memory provider doesn't expose message IDs, so look them up the way SES would.
    const { env } = await import("cloudflare:test")
    const row = await env.DB.prepare(
      `SELECT d.provider_message_id AS id FROM deliveries d JOIN contacts c ON c.id = d.contact_id
       WHERE d.campaign_id = ? AND c.email = ?`
    )
      .bind(campaignId, email)
      .first<{ id: string }>()
    return row!.id
  }

  const sesEvent = (eventType: string, messageId: string, extra = {}) => ({
    eventType,
    mail: { messageId },
    ...extra,
  })

  it("rejects events without the webhook secret", async () => {
    const response = await postSesEvent(sesEvent("Delivery", "x"), "wrong")
    expect(response.status).toBe(401)
  })

  it("records deliveries", async () => {
    const id = await sendCampaign()
    await postSesEvent(sesEvent("Delivery", await messageIdFor(id, "ann@example.com")))
    expect((await getCampaign(id)).counts).toMatchObject({ delivered: 1, sent: 1 })
  })

  it("a permanent bounce marks the contact bounced and excludes it from later campaigns", async () => {
    const id = await sendCampaign()
    await postSesEvent(
      sesEvent("Bounce", await messageIdFor(id, "ann@example.com"), {
        bounce: { bounceType: "Permanent" },
      })
    )
    expect((await getCampaign(id)).counts.bounced).toBe(1)
    expect(await contactStatus("ann@example.com")).toBe("bounced")

    sentEmails().length = 0
    await sendCampaign()
    expect(sentEmails().map((email) => email.to)).toEqual(["bob@example.com"])
  })

  it("a transient bounce changes nothing", async () => {
    const id = await sendCampaign()
    await postSesEvent(
      sesEvent("Bounce", await messageIdFor(id, "ann@example.com"), {
        bounce: { bounceType: "Transient" },
      })
    )
    expect(await contactStatus("ann@example.com")).toBe("subscribed")
  })

  it("a spam complaint marks the contact complained", async () => {
    const id = await sendCampaign()
    await postSesEvent(sesEvent("Complaint", await messageIdFor(id, "bob@example.com")))
    expect((await getCampaign(id)).counts.complained).toBe(1)
    expect(await contactStatus("bob@example.com")).toBe("complained")
  })

  it("the contacts API can't resubscribe a bounced contact", async () => {
    const id = await sendCampaign()
    await postSesEvent(
      sesEvent("Bounce", await messageIdFor(id, "ann@example.com"), {
        bounce: { bounceType: "Permanent" },
      })
    )
    await request("/api/v1/contacts/u1", {
      method: "PUT",
      bearer: apiKey,
      json: { email: "ann@example.com", unsubscribed: false },
    })
    expect(await contactStatus("ann@example.com")).toBe("bounced")
  })
})
