import { Hono } from "hono"

import { markEventsConnected } from "../domain/senders"
import { applyProviderEvent } from "../domain/events"
import { parseSesEvent } from "../email/ses"
import { timingSafeEqual } from "../lib/crypto"
import { getSettings } from "../lib/settings"

type SnsMessage = {
  Type?: string
  TopicArn?: string
  SubscribeURL?: string
  Message?: string
}

/**
 * Delivery reports from SES, through the SNS topic each sender sets up. The webhook secret in
 * the path keeps anyone else from posting fake bounces.
 */
export const hooks = new Hono().post("/ses/:secret", async (c) => {
  const { webhookSecret } = await getSettings()
  if (!timingSafeEqual(c.req.param("secret"), webhookSecret)) {
    return c.json({ error: "invalid_secret" }, 401)
  }
  // SNS posts JSON labelled text/plain.
  const message = JSON.parse(await c.req.text()) as SnsMessage
  if (message.Type === "SubscriptionConfirmation") {
    if (!isSnsUrl(message.SubscribeURL)) return c.json({ error: "invalid_subscribe_url" }, 400)
    const confirmed = await fetch(message.SubscribeURL)
    if (!confirmed.ok) return c.json({ error: "confirmation_failed" }, 502)
  } else if (message.Type === "Notification") {
    const event = parseSesEvent(JSON.parse(message.Message ?? "null"))
    if (event) await applyProviderEvent(event)
  }
  if (message.TopicArn) await markEventsConnected(message.TopicArn)
  return c.json({ ok: true })
})

/** Confirming only fetches AWS's own SNS URLs, never one an attacker picked. */
function isSnsUrl(url: string | undefined): url is string {
  if (!url) return false
  const { protocol, hostname } = new URL(url)
  return protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(hostname)
}
