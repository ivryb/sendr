import { env } from "cloudflare:workers"
import { Hono } from "hono"

import { findMedia } from "../domain/media"

/** Uploaded media, public so emails can show and link to it. Ranges let players seek. */
export const media = new Hono().get("/:id/:name", async (c) => {
  const row = await findMedia(c.req.param("id"))
  if (!row) return c.text("Not found.", 404)
  const rangeHeader = c.req.header("range")
  // Local R2 answers a range past the end with the whole file instead of refusing it.
  const start = Number(rangeHeader?.match(/^bytes=(\d+)-/)?.[1])
  if (start >= row.size) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${row.size}` } })
  }

  const object = await env.MEDIA.get(row.key, { range: c.req.raw.headers, onlyIf: c.req.raw.headers })
  if (!object) return c.text("Not found.", 404)
  const headers = new Headers({
    "accept-ranges": "bytes",
    etag: object.httpEtag,
    "cache-control": "public, max-age=31536000, immutable",
  })
  object.writeHttpMetadata(headers)
  // A matching If-None-Match: the caller's copy is current.
  if (!("body" in object)) return new Response(null, { status: 304, headers })
  const range = rangeHeader ? object.range : undefined
  if (range) headers.set("content-range", contentRange(range, object.size))
  return new Response(object.body, { status: range ? 206 : 200, headers })
})

function contentRange(range: R2Range, size: number) {
  // Local R2 sets all three keys, the unused ones undefined, so the variants can't be told apart by key.
  const { offset, length, suffix } = range as Partial<{ offset: number; length: number; suffix: number }>
  const start = suffix === undefined ? (offset ?? 0) : size - suffix
  const end = length === undefined ? size - 1 : Math.min(start + length, size) - 1
  return `bytes ${start}-${end}/${size}`
}
