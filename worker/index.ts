import { Hono } from "hono"

import { createAuth, isClaimed } from "./auth"
import { getSettings } from "./lib/settings"

const app = new Hono<{ Bindings: Env }>()

app.on(["GET", "POST"], "/api/auth/*", async (c) =>
  createAuth(await getSettings(), c.req.url).handler(c.req.raw)
)

app.get("/api/setup", async (c) => c.json({ claimed: await isClaimed() }))

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>
