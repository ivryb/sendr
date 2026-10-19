import { Hono } from "hono"

import { createAuth, isClaimed } from "./auth"
import { getSettings } from "./lib/settings"
import { adminApi } from "./routes/admin"
import { publicApi } from "./routes/publicApi"

const app = new Hono<{ Bindings: Env }>()
  .on(["GET", "POST"], "/api/auth/*", async (c) =>
    createAuth(await getSettings(), c.req.url).handler(c.req.raw)
  )
  .get("/api/setup", async (c) => c.json({ claimed: await isClaimed() }))
  .route("/api/admin", adminApi)
  .route("/api/v1", publicApi)

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>
