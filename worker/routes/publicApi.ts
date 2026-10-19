import { Hono } from "hono"
import { z } from "zod"

import { findApiKey, touchApiKey } from "../domain/apiKeys"
import {
  contactInput,
  deleteContact,
  upsertContact,
} from "../domain/contacts"
import { parseJson } from "./validation"

const BATCH_LIMIT = 100

const batchInput = z.object({
  contacts: z
    .array(contactInput.extend({ externalId: z.string().min(1) }))
    .min(1)
    .max(BATCH_LIMIT),
})

/** The API host apps use to keep their users in sync. Authenticated with an API key. */
export const publicApi = new Hono()
  .use(async (c, next) => {
    const token = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1]
    const key = token && (await findApiKey(token))
    if (!key) return c.json({ error: "invalid_api_key" }, 401)
    await touchApiKey(key.id)
    await next()
  })
  .post("/contacts/batch", async (c) => {
    const input = await parseJson(c, batchInput)
    const results = []
    for (const { externalId, ...contact } of input.contacts) {
      results.push({ externalId, ...(await upsertContact(externalId, contact)) })
    }
    return c.json({ results })
  })
  .put("/contacts/:externalId", async (c) => {
    const result = await upsertContact(
      c.req.param("externalId"),
      await parseJson(c, contactInput)
    )
    return result.ok ? c.json(result) : c.json(result, 409)
  })
  .delete("/contacts/:externalId", async (c) => {
    await deleteContact(c.req.param("externalId"))
    return c.json({ ok: true })
  })
