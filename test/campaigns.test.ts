import { createMessageBatch } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Campaign, CampaignLink } from "../shared/model"
import worker from "../worker"
import { fakeAws } from "./fake-aws"
import { addSender, createApiKey, request, sentEmails, signInAsAdmin } from "./helpers"

let admin: string
let apiKey: string

beforeEach(async () => {
  admin = await signInAsAdmin()
  await request("/api/v1/settings", {
    method: "PUT",
    cookie: admin,
    json: { footer: "Example Inc, 1 Main St" },
  })
  await addSender(admin)
  apiKey = await createApiKey(admin)
})

async function addContacts(count: number) {
  for (let start = 0; start < count; start += 100) {
    await request("/api/v1/contacts/batch", {
      bearer: apiKey,
      json: {
        contacts: Array.from({ length: Math.min(100, count - start) }, (_, offset) => {
          const i = start + offset
          return {
            externalId: `u${i}`,
            email: `reader${i}@example.com`,
            firstName: i === 0 ? "Ann" : undefined,
          }
        }),
      },
    })
  }
}

async function newCampaign(body: Record<string, unknown> = {}) {
  const response = await request("/api/v1/campaigns", {
    cookie: admin,
    json: { subject: "News for {{first_name|you}}", markdown: "Hey {{first_name|there}}!", ...body },
  })
  return (await response.json<{ campaign: Campaign }>()).campaign
}

async function act(id: string, action: "start" | "approve" | "cancel") {
  return request(`/api/v1/campaigns/${id}/${action}`, { cookie: admin, json: {} })
}

async function campaign(id: string) {
  const response = await request(`/api/v1/campaigns/${id}`, { cookie: admin })
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

  it("sends a list larger than one queue message without losing anyone", async () => {
    await addContacts(250)
    const { id } = await newCampaign({ firstBatchSize: 200 })
    await act(id, "start")
    await reachStatus(id, "awaiting_approval")
    expect(sentEmails()).toHaveLength(200)

    await act(id, "approve")
    await reachStatus(id, "sent")
    expect(new Set(sentEmails().map((email) => email.to)).size).toBe(250)
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
    expect(ann.from).toBe('"Evan" <evan@example.com>')
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

    const draft = await newCampaign()
    await request(`/api/v1/campaigns/${draft.id}`, {
      method: "PUT",
      cookie: admin,
      json: { senderId: null },
    })
    const response = await act(draft.id, "start")
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "not_ready" })
  })

  it("won't send from an address its provider hasn't verified", async () => {
    await addContacts(1)
    const { id } = await newCampaign()
    fakeAws.verified = false
    const response = await act(id, "start")
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      message: "evan@example.com isn't verified yet. Finish its setup in Senders before sending.",
    })
  })

  it("won't start while the SES account is in its sandbox", async () => {
    await addContacts(1)
    const { id } = await newCampaign()
    fakeAws.production = false
    const response = await act(id, "start")
    expect(response.status).toBe(400)
    expect((await response.json<{ message: string }>()).message).toContain("sandbox")
    expect((await campaign(id)).status).toBe("draft")
  })

  it("only drafts can be edited", async () => {
    await addContacts(1)
    const { id } = await newCampaign()
    await act(id, "start")
    const response = await request(`/api/v1/campaigns/${id}`, {
      method: "PUT",
      cookie: admin,
      json: { subject: "Changed" },
    })
    expect(response.status).toBe(409)
  })

  it("a test send goes only to the admin and doesn't count as a delivery", async () => {
    await addContacts(2)
    const { id } = await newCampaign()
    await request(`/api/v1/campaigns/${id}/test`, { cookie: admin, json: {} })

    expect(sentEmails()).toMatchObject([
      { to: "owner@example.com", subject: "[Test] News for you" },
    ])
    expect((await campaign(id)).counts.total).toBe(0)
  })

  it("fills merge tags inside link URLs", async () => {
    const { id } = await newCampaign({
      markdown: "[Your plan](https://acme.com/plan?tier={{fields.plan|free}}&ref=news)",
    })
    await request(`/api/v1/campaigns/${id}/test`, { cookie: admin, json: {} })
    expect(sentEmails()[0].html).toContain('href="https://acme.com/plan?tier=free&amp;ref=news"')
  })

  it("a stray queue message after the campaign finished sends nothing", async () => {
    await addContacts(3)
    const { id } = await newCampaign()
    await act(id, "start")
    await reachStatus(id, "sent")

    const batch = createMessageBatch("sendr-send", [
      { id: "redelivery", timestamp: new Date(), attempts: 2, body: { campaignId: id } },
    ])
    await worker.queue(batch)

    expect(sentEmails()).toHaveLength(3)
  })
})

describe("campaign content", () => {
  it("Markdown is stored as an editor body", async () => {
    const created = await newCampaign({ markdown: "Hello **{{first_name|you}}**" })
    expect(created).toMatchObject({ format: "editor", body: "<p>Hello <strong>{{first_name|you}}</strong></p>\n" })
    expect(created).not.toHaveProperty("markdown")
  })

  it("a draft can switch to raw HTML or plain text", async () => {
    const { id } = await newCampaign({ format: "html", body: "<h1>Hi</h1>", markdown: undefined })
    expect(await campaign(id)).toMatchObject({ format: "html", body: "<h1>Hi</h1>" })
    await request(`/api/v1/campaigns/${id}`, {
      method: "PUT",
      cookie: admin,
      json: { format: "text", body: "Hi there" },
    })
    expect(await campaign(id)).toMatchObject({ format: "text", body: "Hi there" })
  })

  it("a campaign without a message can't start", async () => {
    await addContacts(1)
    const { id } = await newCampaign({ markdown: undefined, body: " " })
    const response = await act(id, "start")
    expect(response.status).toBe(400)
    expect((await response.json<{ message: string }>()).message).toContain("a message")
  })
})

describe("tracking clicks and opens", () => {
  const DOCS = "https://example.com/docs?a=1&b=2"

  async function sendTracked() {
    await request("/api/v1/settings", {
      method: "PUT",
      cookie: admin,
      json: { footer: "Example Inc, [our site](https://example.com)" },
    })
    await addContacts(2)
    const { id } = await newCampaign({
      markdown: `Read [the docs](${DOCS}) or [write us](mailto:hi@example.com).`,
    })
    await act(id, "start")
    await reachStatus(id, "sent")
    return id
  }

  const emailTo = (to: string) => sentEmails().find((email) => email.to === to)!
  const clickLinks = (html: string) =>
    Array.from(html.matchAll(/href="https:\/\/sendr\.test(\/c\/[^"]+)"/g), (match) => match[1])
  const openPixel = (html: string) => html.match(/src="https:\/\/sendr\.test(\/o\/[^"]+)"/)![1]
  // Without "manual", the test fetcher follows the redirect back into the Worker.
  const click = (path: string) => request(path, { redirect: "manual" })

  async function report(id: string) {
    const response = await request(`/api/v1/campaigns/${id}`, { cookie: admin })
    return response.json<{ campaign: Campaign; links: CampaignLink[] }>()
  }

  it("sends links through the instance, which redirects to the original URL", async () => {
    await sendTracked()
    const { html, text } = emailTo("reader0@example.com")

    const [docs, site] = clickLinks(html)
    const redirect = await click(docs)
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get("location")).toBe(DOCS)
    expect((await click(site)).headers.get("location")).toBe("https://example.com")

    expect(html).not.toContain('href="https://example.com')
    expect(html).toContain('href="mailto:hi@example.com"')
    expect(html).toMatch(/href="https:\/\/sendr\.test\/u\/[^"]+"[^>]*>Unsubscribe/)
    expect(text).toContain(DOCS)
  })

  it("counts each recipient's open and click once, even when repeated", async () => {
    const id = await sendTracked()
    const ann = emailTo("reader0@example.com").html
    const other = emailTo("reader1@example.com").html

    for (let i = 0; i < 2; i++) {
      await request(openPixel(ann))
      await click(clickLinks(ann)[0])
    }
    // Images blocked: a click alone still counts as an open.
    await click(clickLinks(other)[0])

    const { campaign, links } = await report(id)
    expect(campaign.counts).toMatchObject({ opened: 2, clicked: 2 })
    expect(links).toEqual([{ url: DOCS, clicks: 2 }])
  })

  it("the open pixel is an uncached image, even for a bad token", async () => {
    const id = await sendTracked()
    const pixel = await request(openPixel(emailTo("reader0@example.com").html))
    expect(pixel.status).toBe(200)
    expect(pixel.headers.get("content-type")).toBe("image/gif")
    expect(pixel.headers.get("cache-control")).toContain("no-store")

    const broken = await request("/o/not-a-token")
    expect(broken.status).toBe(200)
    expect(broken.headers.get("content-type")).toBe("image/gif")
    expect((await report(id)).campaign.counts.opened).toBe(1)
  })

  it("a tampered click link can't redirect anywhere else", async () => {
    await sendTracked()
    const [docs] = clickLinks(emailTo("reader0@example.com").html)
    const [delivery, , signature] = docs.slice("/c/".length).split(".")
    const evil = btoa("https://evil.example").replaceAll("=", "")

    expect((await click(`/c/${delivery}.${evil}.${signature}`)).status).toBe(404)
    expect((await click("/c/garbage")).status).toBe(404)
  })

  it("test sends and single emails keep their real links", async () => {
    const id = await sendTracked()
    sentEmails().length = 0
    await request(`/api/v1/campaigns/${id}/test`, { cookie: admin, json: {} })
    await request("/api/v1/emails", {
      bearer: await createApiKey(admin, ["emails"]),
      json: {
        from: "evan@example.com",
        to: "ann@example.com",
        subject: "Welcome",
        markdown: `See [the docs](${DOCS}).`,
      },
    })

    expect(sentEmails()).toHaveLength(2)
    for (const { html } of sentEmails()) {
      expect(html).toContain('href="https://example.com/docs?a=1&amp;b=2"')
      expect(html).not.toMatch(/sendr\.test\/[co]\//)
    }
  })
})
