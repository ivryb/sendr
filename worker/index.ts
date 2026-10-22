import { Hono } from "hono"
import { createRequestHandler } from "react-router"
import { HTTPException } from "hono/http-exception"

import { createAuth, isClaimed } from "./auth"
import type { SendMessage } from "./domain/campaigns"
import { processSendMessage } from "./domain/sending"
import { DomainError } from "./lib/errors"
import { getSettings } from "./lib/settings"
import { api } from "./routes/api"
import { hooks } from "./routes/hooks"
import { tracking } from "./routes/tracking"
import { unsubscribe } from "./routes/unsubscribe"

const app = new Hono<{ Bindings: Env }>()
  .on(["GET", "POST"], "/api/auth/*", async (c) =>
    createAuth(await getSettings(), c.req.url).handler(c.req.raw)
  )
  .get("/api/setup", async (c) => c.json({ claimed: await isClaimed() }))
  .route("/api/v1", api)
  .route("/hooks", hooks)
  .route("/u", unsubscribe)
  .route("/", tracking)
  .onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse()
    if (error instanceof DomainError) {
      return c.json({ error: error.code, message: error.message }, error.status)
    }
    console.error(error)
    return c.json({ error: "internal_error" }, 500)
  })

// Everything else is the admin app, rendered by React Router.
const renderPage = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
)
app.all("*", (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404)
  return renderPage(c.req.raw)
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
