import { desc, eq, sql } from "drizzle-orm"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"

import type { CampaignLink } from "../../shared/model"
import { db } from "../db/client"
import { clicks, deliveries } from "../db/schema"
import { decodeBase64Url, encodeBase64Url, signToken, verifyToken } from "../lib/crypto"
import { getSettings, type InstanceSettings } from "../lib/settings"

const CLICK_PURPOSE = "click"
const OPEN_PURPOSE = "open"

// An http(s) link's href in rendered HTML: `<a href="...">`, from Markdown or raw HTML.
const LINK = /(<a\s(?:[^>]*?\s)?href=)(["'])(https?:\/\/[^"'<>\s]+)\2/gi

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }

/**
 * Tracks one campaign delivery: its links go through /c to count clicks, and a pixel from /o
 * counts the open. The unsubscribe link and the plain-text part keep their real URLs.
 */
export async function trackEmail(
  html: string,
  { settings, deliveryId, unsubscribeUrl }: {
    settings: InstanceSettings
    deliveryId: string
    unsubscribeUrl: string
  }
) {
  const urls = new Set(Array.from(html.matchAll(LINK), (match) => decodeEntities(match[3])))
  urls.delete(unsubscribeUrl)
  const tracked = new Map(
    await Promise.all(
      Array.from(urls, async (url) => {
        const token = await signToken(settings.secret, CLICK_PURPOSE, clickPayload(deliveryId, url))
        return [url, `${settings.publicUrl}/c/${token}`] as const
      })
    )
  )
  const openToken = await signToken(settings.secret, OPEN_PURPOSE, deliveryId)
  const pixel = `<img src="${settings.publicUrl}/o/${openToken}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">`
  return html
    .replace(LINK, (link, start: string, quote: string, href: string) => {
      const url = tracked.get(decodeEntities(href))
      return url ? `${start}${quote}${url}${quote}` : link
    })
    .replace("</body>", `${pixel}\n</body>`)
}

/**
 * Where a click link leads, after recording the recipient's first click on it. Null when the
 * token wasn't signed here, so /c can't redirect anywhere else.
 */
export async function followClick(token: string) {
  const { secret } = await getSettings()
  const payload = await verifyToken(secret, CLICK_PURPOSE, token)
  if (!payload) return null
  const [deliveryId, encodedUrl] = payload.split(".")
  const url = decodeBase64Url(encodedUrl)
  // The signature vouches for the URL, so a failed write or a missing delivery still redirects.
  await recordClick(deliveryId, url).catch(console.error)
  return url
}

/** Records the first open behind an open pixel's token; anything else is ignored. */
export async function recordOpen(token: string) {
  const { secret } = await getSettings()
  const deliveryId = await verifyToken(secret, OPEN_PURPOSE, token)
  if (!deliveryId) return
  await db()
    .update(deliveries)
    .set({ openedAt: firstTime(deliveries.openedAt) })
    .where(eq(deliveries.id, deliveryId))
}

/** The campaign's clicked links, most clicked first. Each recipient counts once per link. */
export function campaignLinks(campaignId: string): Promise<CampaignLink[]> {
  const count = sql<number>`count(*)`
  return db()
    .select({ url: clicks.url, clicks: count })
    .from(clicks)
    .innerJoin(deliveries, eq(clicks.deliveryId, deliveries.id))
    .where(eq(deliveries.campaignId, campaignId))
    .groupBy(clicks.url)
    .orderBy(desc(count), clicks.url)
}

// A click also counts as an open: many clients block the pixel.
async function recordClick(deliveryId: string, url: string) {
  const [delivery] = await db()
    .update(deliveries)
    .set({ clickedAt: firstTime(deliveries.clickedAt), openedAt: firstTime(deliveries.openedAt) })
    .where(eq(deliveries.id, deliveryId))
    .returning({ id: deliveries.id })
  if (delivery) await db().insert(clicks).values({ deliveryId, url }).onConflictDoNothing()
}

/** Neither delivery IDs nor base64url contain dots, so the payload splits back cleanly. */
function clickPayload(deliveryId: string, url: string) {
  return `${deliveryId}.${encodeBase64Url(url)}`
}

/** Keeps the first time, so repeat opens and clicks don't move it. */
function firstTime(column: AnySQLiteColumn) {
  return sql`coalesce(${column}, ${Date.now()})`
}

function decodeEntities(value: string) {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ENTITIES[name])
}
