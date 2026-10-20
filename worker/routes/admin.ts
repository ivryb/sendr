import { Hono } from "hono"
import { z } from "zod"

import { CONTACT_STATUSES } from "../../shared/model"
import { getAdmin, type Admin } from "../auth"
import { createApiKey, deleteApiKey, listApiKeys } from "../domain/apiKeys"
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
  listContacts,
  setContactStatus,
} from "../domain/contacts"
import { sendTestEmail } from "../domain/sending"
import {
  checkSender,
  connectSender,
  deleteSender,
  listSenders,
  senderChanges,
  senderInput,
  updateSender,
} from "../domain/senders"
import { getSettings, toSettingsDto, updateSettings } from "../lib/settings"
import { parseJson } from "./validation"

const settingsInput = z
  .object({
    footer: z.string(),
    publicUrl: z.union([
      z.url().transform((url) => url.replace(/\/+$/, "")),
      z.literal(""),
    ]),
  })
  .partial()

type AdminEnv = { Variables: { user: Admin } }

/** The admin app's API. Every route requires a signed-in admin. */
export const adminApi = new Hono<AdminEnv>()
  .use(async (c, next) => {
    const admin = await getAdmin(c.req.raw)
    if (!admin) return c.json({ error: "unauthorized" }, 401)
    c.set("user", admin)
    await next()
  })
  .get("/me", (c) => c.json({ user: c.get("user") }))

  .get("/settings", async (c) => c.json(toSettingsDto(await getSettings())))
  .put("/settings", async (c) => {
    const input = await parseJson(c, settingsInput)
    return c.json(toSettingsDto(await updateSettings(input)))
  })

  .get("/senders", async (c) => c.json({ senders: await listSenders() }))
  .post("/senders", async (c) => {
    const input = await parseJson(c, senderInput)
    return c.json({ sender: await connectSender(input, await getSettings()) })
  })
  .get("/senders/:id", async (c) => c.json(await checkSender(c.req.param("id"))))
  .patch("/senders/:id", async (c) =>
    c.json({ sender: await updateSender(c.req.param("id"), await parseJson(c, senderChanges)) })
  )
  .delete("/senders/:id", async (c) => {
    await deleteSender(c.req.param("id"))
    return c.json({ ok: true })
  })

  .get("/contacts", async (c) => {
    const query = z
      .object({
        q: z.string().optional(),
        status: z.enum(CONTACT_STATUSES).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(c.req.query())
    const [list, counts] = await Promise.all([listContacts(query), contactCounts()])
    return c.json({ ...list, counts })
  })
  .post("/contacts/:id/status", async (c) => {
    const { status } = await parseJson(
      c,
      z.object({ status: z.enum(["subscribed", "unsubscribed"]) })
    )
    await setContactStatus(c.req.param("id"), status)
    return c.json({ ok: true })
  })

  .get("/api-keys", async (c) => c.json({ apiKeys: await listApiKeys() }))
  .post("/api-keys", async (c) => {
    const { name } = await parseJson(c, z.object({ name: z.string().trim().min(1) }))
    return c.json({ key: await createApiKey(name) })
  })
  .delete("/api-keys/:id", async (c) => {
    await deleteApiKey(c.req.param("id"))
    return c.json({ ok: true })
  })

  .get("/campaigns", async (c) => c.json({ campaigns: await listCampaigns() }))
  .post("/campaigns", async (c) =>
    c.json({ campaign: await createCampaign(await parseJson(c, campaignInput)) })
  )
  .get("/campaigns/:id", async (c) =>
    c.json({ campaign: await getCampaign(c.req.param("id")) })
  )
  .put("/campaigns/:id", async (c) =>
    c.json({
      campaign: await updateDraft(c.req.param("id"), await parseJson(c, campaignInput)),
    })
  )
  .delete("/campaigns/:id", async (c) => {
    await deleteDraft(c.req.param("id"))
    return c.json({ ok: true })
  })
  .post("/campaigns/:id/test", async (c) => {
    const { to } = await parseJson(c, z.object({ to: z.email().optional() }))
    const user = c.get("user")
    await sendTestEmail(c.req.param("id"), { email: to ?? user.email, name: user.name })
    return c.json({ ok: true })
  })
  .post("/campaigns/:id/start", async (c) =>
    c.json({ campaign: await startCampaign(c.req.param("id"), await getSettings()) })
  )
  .post("/campaigns/:id/approve", async (c) =>
    c.json({ campaign: await approveCampaign(c.req.param("id")) })
  )
  .post("/campaigns/:id/cancel", async (c) =>
    c.json({ campaign: await cancelCampaign(c.req.param("id")) })
  )
