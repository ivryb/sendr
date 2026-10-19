import { beforeEach, describe, expect, it } from "vitest"

import type { Contact } from "../shared/model"
import { request, signInAsAdmin } from "./helpers"

let admin: string
let apiKey: string

beforeEach(async () => {
  admin = await signInAsAdmin()
  const created = await request("/api/admin/api-keys", {
    cookie: admin,
    json: { name: "Listenly" },
  })
  apiKey = (await created.json<{ key: string }>()).key
})

const upsert = (externalId: string, body: Record<string, unknown>) =>
  request(`/api/v1/contacts/${externalId}`, {
    method: "PUT",
    bearer: apiKey,
    json: body,
  })

async function listContacts(query = "") {
  const response = await request(`/api/admin/contacts${query}`, { cookie: admin })
  return (await response.json<{ contacts: Contact[] }>()).contacts
}

describe("contacts API", () => {
  it("rejects requests without a valid API key", async () => {
    const response = await request("/api/v1/contacts/u1", {
      method: "PUT",
      bearer: "sk_wrong",
      json: { email: "a@example.com" },
    })
    expect(response.status).toBe(401)
  })

  it("adds a subscribed contact keyed by the host's user ID", async () => {
    const response = await upsert("u1", {
      email: "Ann@Example.com",
      firstName: "Ann",
      fields: { plan: "pro" },
    })
    expect(response.status).toBe(200)
    expect(await listContacts()).toMatchObject([
      {
        externalId: "u1",
        email: "ann@example.com",
        firstName: "Ann",
        fields: { plan: "pro" },
        status: "subscribed",
      },
    ])
  })

  it("upserting the same user twice keeps one contact and follows an email change", async () => {
    await upsert("u1", { email: "ann@example.com" })
    await upsert("u1", { email: "ann@new.example.com", firstName: "Ann" })
    expect(await listContacts()).toMatchObject([
      { externalId: "u1", email: "ann@new.example.com", firstName: "Ann" },
    ])
  })

  it("can mark a contact unsubscribed but never resubscribes one", async () => {
    await upsert("u1", { email: "ann@example.com", unsubscribed: true })
    expect((await listContacts())[0].status).toBe("unsubscribed")

    await upsert("u1", { email: "ann@example.com", unsubscribed: false })
    expect((await listContacts())[0].status).toBe("unsubscribed")
  })

  it("rejects an email that belongs to another user", async () => {
    await upsert("u1", { email: "ann@example.com" })
    const response = await upsert("u2", { email: "ann@example.com" })
    expect(response.status).toBe(409)
  })

  it("rejects an invalid email", async () => {
    const response = await upsert("u1", { email: "not-an-email" })
    expect(response.status).toBe(400)
  })

  it("adds many contacts in one batch call and reports each result", async () => {
    await upsert("u0", { email: "taken@example.com" })
    const response = await request("/api/v1/contacts/batch", {
      bearer: apiKey,
      json: {
        contacts: [
          { externalId: "u1", email: "one@example.com" },
          { externalId: "u2", email: "two@example.com", unsubscribed: true },
          { externalId: "u3", email: "taken@example.com" },
        ],
      },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      results: [
        { externalId: "u1", ok: true },
        { externalId: "u2", ok: true },
        { externalId: "u3", ok: false, error: "email_taken" },
      ],
    })
    expect(await listContacts("?status=subscribed")).toHaveLength(2)
  })

  it("deleting a contact removes it", async () => {
    await upsert("u1", { email: "ann@example.com" })
    const response = await request("/api/v1/contacts/u1", {
      method: "DELETE",
      bearer: apiKey,
    })
    expect(response.status).toBe(200)
    expect(await listContacts()).toEqual([])
  })

  it("a revoked API key stops working", async () => {
    const keys = await request("/api/admin/api-keys", { cookie: admin })
    const [key] = (await keys.json<{ apiKeys: { id: string }[] }>()).apiKeys
    await request(`/api/admin/api-keys/${key.id}`, {
      method: "DELETE",
      cookie: admin,
    })
    expect((await upsert("u1", { email: "ann@example.com" })).status).toBe(401)
  })
})

describe("admin contact management", () => {
  it("the admin API requires a signed-in admin", async () => {
    expect((await request("/api/admin/contacts")).status).toBe(401)
  })

  it("searches contacts by email or name", async () => {
    await upsert("u1", { email: "ann@example.com", firstName: "Ann" })
    await upsert("u2", { email: "bob@example.com", firstName: "Bob" })
    expect((await listContacts("?q=bob")).map((c) => c.externalId)).toEqual(["u2"])
  })

  it("the admin can unsubscribe and resubscribe a contact", async () => {
    await upsert("u1", { email: "ann@example.com" })
    const [contact] = await listContacts()
    await request(`/api/admin/contacts/${contact.id}/status`, {
      cookie: admin,
      json: { status: "unsubscribed" },
    })
    expect((await listContacts())[0].status).toBe("unsubscribed")
    await request(`/api/admin/contacts/${contact.id}/status`, {
      cookie: admin,
      json: { status: "subscribed" },
    })
    expect((await listContacts())[0].status).toBe("subscribed")
  })
})
