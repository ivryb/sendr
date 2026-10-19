import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { CONTACT_STATUSES } from "../../shared/model"
import { createAuth } from "../auth"
import { contacts } from "../db/schema"
import { createApiKey, deleteApiKey, listApiKeys } from "../domain/apiKeys"
import {
  contactCounts,
  listContacts,
  setContactStatus,
} from "../domain/contacts"
import { getSettings } from "../lib/settings"
import { parseJson } from "./validation"

type AdminEnv = { Variables: { user: { id: string; email: string; name: string } } }

/** The admin app's API. Every route requires a signed-in admin. */
export const adminApi = new Hono<AdminEnv>()
  .use(async (c, next) => {
    const auth = createAuth(await getSettings(), c.req.url)
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: "unauthorized" }, 401)
    c.set("user", session.user)
    await next()
  })
  .get("/me", (c) => c.json({ user: c.get("user") }))

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
    await setContactStatus(eq(contacts.id, c.req.param("id")), status)
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
