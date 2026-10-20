import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { z } from "zod"

import { API_KEY_ACCESS, CONTACT_STATUSES, type ApiKeyAccess } from "../../shared/model"
import { getAdmin, type Admin } from "../auth"
import { createApiKey, deleteApiKey, findApiKey, listApiKeys, touchApiKey } from "../domain/apiKeys"
import {
  approveCampaign,
  campaignInput,
  cancelCampaign,
  createCampaign,
  deleteDraft,
  getCampaign,
  listCampaigns,
  startCampaign,
  updateDraft,
} from "../domain/campaigns"
import {
  contactCounts,
  contactInput,
  deleteContact,
  listContacts,
  setContactStatus,
  upsertContact,
} from "../domain/contacts"
import { emailInput, getEmail, sendSingleEmail } from "../domain/emails"
import {
  checkSender,
  connectSender,
  deleteSender,
  listSenders,
  senderChanges,
  senderInput,
  updateSender,
} from "../domain/senders"
import { sendTestEmail } from "../domain/sending"
import { getSettings, toSettingsDto, updateSettings } from "../lib/settings"
import { apiDocs } from "./docs"
import { parseJson } from "./validation"

/** Who is calling: the signed-in admin (the admin app), or an app or agent with an API key. */
type Caller = { admin: Admin; access: "full" } | { admin: null; access: ApiKeyAccess }

type ApiEnv = { Variables: { caller: Caller } }

const authenticate = createMiddleware<ApiEnv>(async (c, next) => {
  const token = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1]
  if (token) {
    const key = await findApiKey(token)
    if (!key) return c.json({ error: "invalid_api_key", message: "That API key doesn't exist." }, 401)
    await touchApiKey(key.id)
    c.set("caller", { admin: null, access: key.access })
  } else {
    const admin = await getAdmin(c.req.raw)
    if (!admin) return c.json({ error: "unauthorized", message: "Sign in, or send an API key." }, 401)
    c.set("caller", { admin, access: "full" })
  }
  await next()
})

/** Allows callers with `access` or full access. "admin" is only the signed-in admin. */
function requires(access: ApiKeyAccess | "admin") {
  return createMiddleware<ApiEnv>(async (c, next) => {
    const caller = c.get("caller")
    const allowed =
      access === "admin" ? caller.admin !== null : caller.access === "full" || caller.access === access
    if (!allowed) {
      const needed = access === "admin" ? "a signed-in admin" : `an API key with ${access} access`
      return c.json({ error: "forbidden", message: `This needs ${needed}.` }, 403)
    }
    await next()
  })
}

const BATCH_LIMIT = 100

const contactsQuery = z.object({
  q: z.string().optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

const batchInput = z.object({
  contacts: z
    .array(contactInput.extend({ externalId: z.string().min(1) }))
    .min(1)
    .max(BATCH_LIMIT),
})

const settingsInput = z
  .object({
    footer: z.string(),
    publicUrl: z.union([z.url().transform((url) => url.replace(/\/+$/, "")), z.literal("")]),
  })
  .partial()

/**
 * Sendr's API: everything the admin app does, for apps and agents too. The admin app calls it
 * with its session; apps and agents with an API key. GET /api/v1/docs describes it.
 */
export const api = new Hono<ApiEnv>()
  .get("/docs", async (c) => {
    const { publicUrl } = await getSettings()
    return c.text(apiDocs(publicUrl || new URL(c.req.url).origin), 200, {
      "content-type": "text/markdown; charset=utf-8",
    })
  })
  .use(authenticate)
  .get("/me", (c) => {
    const { admin, access } = c.get("caller")
    return c.json({ access, admin })
  })

  // Contacts
  .get("/contacts", requires("contacts"), async (c) => {
    const query = contactsQuery.parse(c.req.query())
    const [list, counts] = await Promise.all([listContacts(query), contactCounts()])
    return c.json({ ...list, counts })
  })
  .put("/contacts/:externalId", requires("contacts"), async (c) => {
    const result = await upsertContact(c.req.param("externalId"), await parseJson(c, contactInput))
    return result.ok ? c.json(result) : c.json(result, 409)
  })
  .post("/contacts/batch", requires("contacts"), async (c) => {
    const input = await parseJson(c, batchInput)
    const results = []
    for (const { externalId, ...contact } of input.contacts) {
      results.push({ externalId, ...(await upsertContact(externalId, contact)) })
    }
    return c.json({ results })
  })
  .delete("/contacts/:externalId", requires("contacts"), async (c) => {
    await deleteContact(c.req.param("externalId"))
    return c.json({ ok: true })
  })
  // Resubscribing is only for someone who asked; an app's contacts key can't do it.
  .post("/contacts/:id/status", requires("full"), async (c) => {
    const { status } = await parseJson(c, z.object({ status: z.enum(["subscribed", "unsubscribed"]) }))
    await setContactStatus(c.req.param("id"), status)
    return c.json({ ok: true })
  })

  // Single emails
  .post("/emails", requires("emails"), async (c) =>
    c.json({ email: await sendSingleEmail(await parseJson(c, emailInput)) })
  )
  .get("/emails/:id", requires("emails"), async (c) => c.json({ email: await getEmail(c.req.param("id")) }))

  // Campaigns
  .get("/campaigns", requires("full"), async (c) => c.json({ campaigns: await listCampaigns() }))
  .post("/campaigns", requires("full"), async (c) =>
    c.json({ campaign: await createCampaign(await parseJson(c, campaignInput)) })
  )
  .get("/campaigns/:id", requires("full"), async (c) =>
    c.json({ campaign: await getCampaign(c.req.param("id")) })
  )
  .put("/campaigns/:id", requires("full"), async (c) =>
    c.json({ campaign: await updateDraft(c.req.param("id"), await parseJson(c, campaignInput)) })
  )
  .delete("/campaigns/:id", requires("full"), async (c) => {
    await deleteDraft(c.req.param("id"))
    return c.json({ ok: true })
  })
  .post("/campaigns/:id/test", requires("full"), async (c) => {
    const { to } = await parseJson(c, z.object({ to: z.email().optional() }))
    const { admin } = c.get("caller")
    const recipient = to ? { email: to, name: "" } : admin
    if (!recipient) {
      return c.json({ error: "invalid_request", message: "Say who gets the test with `to`." }, 400)
    }
    await sendTestEmail(c.req.param("id"), recipient)
    return c.json({ ok: true })
  })
  .post("/campaigns/:id/start", requires("full"), async (c) =>
    c.json({ campaign: await startCampaign(c.req.param("id"), await getSettings()) })
  )
  .post("/campaigns/:id/approve", requires("full"), async (c) => {
    await approveCampaign(c.req.param("id"))
    return c.json({ campaign: await getCampaign(c.req.param("id")) })
  })
  .post("/campaigns/:id/cancel", requires("full"), async (c) => {
    await cancelCampaign(c.req.param("id"))
    return c.json({ campaign: await getCampaign(c.req.param("id")) })
  })

  // Senders
  .get("/senders", requires("full"), async (c) => c.json({ senders: await listSenders() }))
  .post("/senders", requires("full"), async (c) =>
    c.json({ sender: await connectSender(await parseJson(c, senderInput), await getSettings()) })
  )
  .get("/senders/:id", requires("full"), async (c) => c.json(await checkSender(c.req.param("id"))))
  .patch("/senders/:id", requires("full"), async (c) =>
    c.json({ sender: await updateSender(c.req.param("id"), await parseJson(c, senderChanges)) })
  )
  .delete("/senders/:id", requires("full"), async (c) => {
    await deleteSender(c.req.param("id"))
    return c.json({ ok: true })
  })

  // Settings
  .get("/settings", requires("full"), async (c) => c.json(toSettingsDto(await getSettings())))
  .put("/settings", requires("full"), async (c) =>
    c.json(toSettingsDto(await updateSettings(await parseJson(c, settingsInput))))
  )

  // API keys stay with the admin, so a leaked key can't mint more.
  .get("/api-keys", requires("admin"), async (c) => c.json({ apiKeys: await listApiKeys() }))
  .post("/api-keys", requires("admin"), async (c) => {
    const { name, access } = await parseJson(
      c,
      z.object({ name: z.string().trim().min(1), access: z.enum(API_KEY_ACCESS) })
    )
    return c.json({ key: await createApiKey(name, access) })
  })
  .delete("/api-keys/:id", requires("admin"), async (c) => {
    await deleteApiKey(c.req.param("id"))
    return c.json({ ok: true })
  })
