import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"

import { createAuth, isClaimed } from "./auth"
import { CampaignError, type SendMessage } from "./domain/campaigns"
import { processSendMessage } from "./domain/sending"
import { getSettings } from "./lib/settings"
import { adminApi } from "./routes/admin"
import { hooks } from "./routes/hooks"
import { publicApi } from "./routes/publicApi"
import { serverRender } from "./ssr"
import { unsubscribe } from "./routes/unsubscribe"

const CAMPAIGN_ERROR_STATUS = { not_found: 404, invalid_action: 409, not_ready: 400 } as const

const app = new Hono<{ Bindings: Env }>()
  .on(["GET", "POST"], "/api/auth/*", async (c) =>
    createAuth(await getSettings(), c.req.url).handler(c.req.raw)
  )
  .get("/api/setup", async (c) => c.json({ claimed: await isClaimed() }))
  .route("/api/admin", adminApi)
  .route("/api/v1", publicApi)
  .route("/hooks", hooks)
  .route("/u", unsubscribe)
  .onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse()
    if (error instanceof CampaignError) {
      return c.json(
        { error: error.code, message: error.message },
        CAMPAIGN_ERROR_STATUS[error.code]
      )
    }
    console.error(error)
    return c.json({ error: "internal_error" }, 500)
  })

// Page navigations are admin pages, rendered on the server. Other requests (scripts, and
// in development Vite's modules) go to the static files.
app.get("*", (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404)
  if (!c.req.header("accept")?.includes("text/html")) return c.env.ASSETS.fetch(c.req.raw)
  return serverRender(c.req.raw, app)
})

export default {
  fetch: app.fetch,
  async queue(batch) {
    for (const message of batch.messages) {
      await processSendMessage(message.body)
      message.ack()
    }
  },
} satisfies ExportedHandler<Env, SendMessage>
