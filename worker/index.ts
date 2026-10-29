import { Hono } from "hono"
import { createRequestHandler } from "react-router"
import { HTTPException } from "hono/http-exception"
import { DrizzleQueryError } from "drizzle-orm/errors"

import { createAuth, isClaimed } from "./auth"
import type { SendMessage } from "./domain/campaigns"
import { processSendMessage } from "./domain/sending"
import { DomainError } from "./lib/errors"
import { limitError, secondsUntilReset } from "./lib/limits"
import { getSettings } from "./lib/settings"
import { api } from "./routes/api"
import { hooks } from "./routes/hooks"
import { media } from "./routes/media"
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
  .route("/media", media)
  .route("/", tracking)
  .onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse()
    const known = error instanceof DomainError ? error : limitError(error)
    if (known) return c.json({ error: known.code, message: known.message }, known.status)
    // Drizzle's message lists the query's values, which can be secrets like a sender's AWS key.
    if (error instanceof DrizzleQueryError) console.error(`Failed query: ${error.query}`, error.cause)
    else console.error(error)
    return c.json({ error: "internal_error" }, 500)
  })

// Workers Free queues keep a message for 24 hours. A limit still on at the retry after the
// reset would otherwise wait another whole day and expire the message, ending the campaign.
const MAX_LIMIT_WAIT = 12 * 60 * 60

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
      try {
        await processSendMessage(message.body)
        message.ack()
      } catch (error) {
        // A used-up daily limit fails every query until 00:00 UTC. The usual retries, a minute
        // apart, would all fail and drop the message, so it waits until 5 minutes past the reset.
        const limit = limitError(error)
        if (!limit?.daily) throw error
        console.warn(limit.message)
        message.retry({ delaySeconds: Math.min(secondsUntilReset() + 300, MAX_LIMIT_WAIT) })
      }
    }
  },
} satisfies ExportedHandler<Env, SendMessage>
