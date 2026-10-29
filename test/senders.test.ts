import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DnsRecord, Sender } from "../shared/model"
import { fakeAws, TOPIC_ARN } from "./fake-aws"
import {
  addSender,
  createApiKey,
  request,
  SENDER,
  signInAsAdmin,
  webhookSecret,
} from "./helpers"

let admin: string

beforeEach(async () => {
  admin = await signInAsAdmin()
})

type Check =
  | { ok: true; sender: Sender; domain: string; records: DnsRecord[] }
  | { ok: false; sender: Sender; error: string }

async function check(id: string) {
  return (await request(`/api/v1/senders/${id}`, { cookie: admin })).json<Check>()
}

describe("connecting a sender", () => {
  it("sets up SES delivery reports and starts verifying the domain", async () => {
    fakeAws.verified = false
    const sender = await addSender(admin)

    const calls = fakeAws.requests.map(({ method, url, body }) => {
      const action = new URLSearchParams(body).get("Action")
      return action ? `SNS ${action}` : `${method} ${new URL(url).pathname}`
    })
    expect(calls).toEqual(
      expect.arrayContaining([
        "SNS CreateTopic",
        "SNS Subscribe",
        "POST /v2/email/configuration-sets",
        "POST /v2/email/configuration-sets/sendr/event-destinations",
        "POST /v2/email/identities",
        "PUT /v2/email/identities/example.com/mail-from",
      ])
    )
    const subscribe = fakeAws.requests.find(({ body }) => body.includes("Action=Subscribe"))
    expect(new URLSearchParams(subscribe!.body).get("Endpoint")).toBe(
      `https://sendr.test/hooks/ses/${await webhookSecret()}`
    )

    const status = await check(sender.id)
    expect(status).toMatchObject({ ok: true, domain: "example.com", sender: { verified: false } })
    expect(status.ok && status.records.map((record) => `${record.type} ${record.name}`)).toEqual([
      "CNAME tok1._domainkey.example.com",
      "CNAME tok2._domainkey.example.com",
      "CNAME tok3._domainkey.example.com",
      "MX bounce.example.com",
      "TXT bounce.example.com",
      "TXT _dmarc.example.com",
    ])
  })

  it("has SES suppress addresses that bounced or complained, for senders connected before too", async () => {
    const suppression = () =>
      fakeAws.requests
        .filter(({ url }) => url.endsWith("/v2/email/configuration-sets/sendr/suppression-options"))
        .map(({ method, body }) => ({ method, body: JSON.parse(body) }))
    const expected = { method: "PUT", body: { SuppressedReasons: ["BOUNCE", "COMPLAINT"] } }

    const sender = await addSender(admin)
    expect(suppression()).toContainEqual(expected)

    // A sender connected before Sendr set this gets it on its next check, as a campaign starts.
    fakeAws.requests = []
    expect(await check(sender.id)).toMatchObject({ ok: true })
    expect(suppression()).toEqual([expected])
  })

  it("explains a key AWS rejects, and saves nothing", async () => {
    fakeAws.rejectKey = true
    const response = await request("/api/v1/senders", { cookie: admin, json: SENDER })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      message: "AWS didn't accept this access key. Check both parts and the region.",
    })
    const list = await request("/api/v1/senders", { cookie: admin })
    expect(await list.json()).toEqual({ senders: [] })
  })

  it("isn't open to signed-out visitors", async () => {
    const response = await request("/api/v1/senders", { json: SENDER })
    expect(response.status).toBe(401)
  })

  it("a failed save logs why, without the AWS secret key", async () => {
    await env.DB.exec("CREATE TRIGGER refuse BEFORE INSERT ON senders BEGIN SELECT RAISE(ABORT, 'disk full'); END")
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const response = await request("/api/v1/senders", { cookie: admin, json: SENDER })
    expect(response.status).toBe(500)

    const output = logged.mock.calls.flat().map((part) => (part instanceof Error ? part.stack : String(part)))
    logged.mockRestore()
    expect(output.join("\n")).not.toContain(SENDER.secretAccessKey)
    expect(output.join("\n")).toContain("disk full")
  })
})

describe("delivery reports", () => {
  it("confirms the SNS subscription and marks reports as connected", async () => {
    const sender = await addSender(admin)
    const confirm = "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=t"
    const response = await request(`/hooks/ses/${await webhookSecret()}`, {
      json: { Type: "SubscriptionConfirmation", TopicArn: TOPIC_ARN, SubscribeURL: confirm },
    })
    expect(response.status).toBe(200)
    expect(fakeAws.requests.some(({ url }) => url === confirm)).toBe(true)
    expect((await check(sender.id)).sender.eventsConnected).toBe(true)
  })

  it("never follows a confirmation link outside AWS", async () => {
    const response = await request(`/hooks/ses/${await webhookSecret()}`, {
      json: { Type: "SubscriptionConfirmation", SubscribeURL: "https://evil.example/confirm" },
    })
    expect(response.status).toBe(400)
  })
})

describe("removing a sender", () => {
  it("waits until its campaigns finish sending", async () => {
    const sender = await addSender(admin)
    const apiKey = await createApiKey(admin)
    await request("/api/v1/contacts/batch", {
      bearer: apiKey,
      json: { contacts: [{ externalId: "u1", email: "ann@example.com" }] },
    })
    const created = await request("/api/v1/campaigns", {
      cookie: admin,
      json: { subject: "Hi", markdown: "Hello" },
    })
    const { campaign } = await created.json<{ campaign: { id: string } }>()
    await request(`/api/v1/campaigns/${campaign.id}/start`, { cookie: admin, json: {} })

    const blocked = await request(`/api/v1/senders/${sender.id}`, { method: "DELETE", cookie: admin })
    expect(blocked.status).toBe(400)

    await request(`/api/v1/campaigns/${campaign.id}/cancel`, { cookie: admin, json: {} })
    const removed = await request(`/api/v1/senders/${sender.id}`, { method: "DELETE", cookie: admin })
    expect(removed.status).toBe(200)
  })
})
