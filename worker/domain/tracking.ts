import { desc, eq, sql } from "drizzle-orm"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"

import type { CampaignLink } from "../../shared/model"
import type { RenderedEmail } from "../../shared/render"
import { db } from "../db/client"
import { clicks, deliveries } from "../db/schema"
import { decodeBase64Url, encodeBase64Url, signToken, verifyToken } from "../lib/crypto"
import { getSettings, type InstanceSettings } from "../lib/settings"

const CLICK_PURPOSE = "click"
const OPEN_PURPOSE = "open"

// An http(s) link's href in rendered HTML: `<a href="...">`, from the editor or raw HTML.
const LINK = /(<a\s(?:[^>]*?\s)?href=)(["'])(https?:\/\/[^"'<>\s]+)\2/gi
// A URL in plain text, without the punctuation that usually ends a sentence after it.
const BARE_URL = /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/g

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }

type Delivery = { settings: InstanceSettings; deliveryId: string; unsubscribeUrl: string }

/**
 * Tracks one campaign delivery: its links go through /c to count clicks, and a pixel from /o
 * counts the open. The unsubscribe link keeps its real URL, and so does the plain-text part of
 * an HTML email. A text-only email has no pixel, so only its clicks count.
 */
export async function trackEmail({ template, ...email }: RenderedEmail, delivery: Delivery) {
  const written = writtenLinks(links(template))
  const tracked = await clickUrls(
    links(email).filter((url) => written.some((link) => link.test(url))),
    delivery
  )
  const { html, text } = email
  if (html === null) return { ...email, text: text.replace(BARE_URL, (url) => tracked.get(url) ?? url) }
  const { settings, deliveryId } = delivery
  const openToken = await signToken(settings.secret, OPEN_PURPOSE, deliveryId)
  const pixel = `<img src="${settings.publicUrl}/o/${openToken}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">`
  const trackedHtml = html
    .replace(LINK, (link, start: string, quote: string, href: string) => {
      const url = tracked.get(decodeEntities(href))
      return url ? `${start}${quote}${url}${quote}` : link
    })
    .replace(/<\/body\s*>/i, (end) => `${pixel}\n${end}`)
  return { ...email, html: trackedHtml }
}

/** The links tracking wraps: hrefs in HTML, or the bare URLs of a text-only email. */
function links({ html, text }: { html: string | null; text: string }) {
  if (html === null) return text.match(BARE_URL) ?? []
  return Array.from(html.matchAll(LINK), (match) => decodeEntities(match[3]))
}

/**
 * The campaign's own links, as patterns a sent link must match to be tracked. A merge tag
 * matches anything, but only after the host, so a contact whose name is a URL, or whose field
 * fills a whole link, can't get a signed redirect to wherever they like.
 */
function writtenLinks(urls: string[]) {
  return urls
    .filter((url) => !/^https?:\/\/[^/?#]*\{\{/i.test(url))
    .map((url) => new RegExp(`^${url.split(/\{\{.*?\}\}/).map(escapeRegExp).join(".*")}$`))
}

/** Each URL's /c link, except the unsubscribe link's. */
async function clickUrls(urls: string[], { settings, deliveryId, unsubscribeUrl }: Delivery) {
  const unique = new Set(urls)
  unique.delete(unsubscribeUrl)
  return new Map(
    await Promise.all(
      Array.from(unique, async (url) => {
        const token = await signToken(settings.secret, CLICK_PURPOSE, clickPayload(deliveryId, url))
        return [url, `${settings.publicUrl}/c/${token}`] as const
      })
    )
  )
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

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function decodeEntities(value: string) {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ENTITIES[name])
}
