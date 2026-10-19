import { Hono } from "hono"

import { applyProviderEvents } from "../domain/events"
import type { ProviderEvent } from "../email/provider"
import { parseSesEvents } from "../email/ses"
import { timingSafeEqual } from "../lib/crypto"
import { getSettings } from "../lib/settings"

const EVENT_PARSERS: Record<string, (body: unknown) => ProviderEvent[]> = {
  ses: parseSesEvents,
}

/** Provider event webhooks, authenticated by the instance's webhook secret header. */
export const hooks = new Hono().post("/:provider", async (c) => {
  const parse = EVENT_PARSERS[c.req.param("provider")]
  if (!parse) return c.json({ error: "unknown_provider" }, 404)

  const { webhookSecret } = await getSettings()
  const secret = c.req.header("x-sendr-secret") ?? ""
  if (!timingSafeEqual(secret, webhookSecret)) {
    return c.json({ error: "invalid_secret" }, 401)
  }

  const events = parse(await c.req.json().catch(() => null))
  await applyProviderEvents(events)
  return c.json({ received: events.length })
})
