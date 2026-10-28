import { env } from "cloudflare:workers"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { MEDIA_KINDS, type Media } from "../../shared/model"
import { db } from "../db/client"
import { media } from "../db/schema"
import { DomainError } from "../lib/errors"

// Workers take request bodies up to 100 MB.
const MAX_BYTES = 100 * 1024 * 1024

export const mediaQuery = z.object({
  name: z.string().trim().min(1).max(255),
  /** An uploaded image's id, as a video's or audio's cover. */
  poster: z.string().optional(),
  duration: z.coerce.number().positive().optional(),
})

type Upload = z.infer<typeof mediaQuery> & {
  contentType: string
  size: number
  body: ReadableStream | null
}

type MediaRow = typeof media.$inferSelect

/** Stores an upload in R2 as it streams in, so a large video never sits in Worker memory. */
export async function uploadMedia(upload: Upload, baseUrl: string): Promise<Media> {
  if (!upload.body || !(upload.size > 0)) {
    throw new DomainError("length_required", 411, "Send the file as the body, with its size in Content-Length.")
  }
  if (upload.size > MAX_BYTES) throw new DomainError("too_large", 413, "Files can be up to 100 MB.")
  const contentType = upload.contentType.split(";")[0].trim().toLowerCase()
  const kind = MEDIA_KINDS.find((kind) => contentType.startsWith(`${kind}/`))
  // SVG can carry scripts, and it's served from the admin app's origin; email clients rarely show it anyway.
  if (!kind || contentType === "image/svg+xml") {
    throw new DomainError("unsupported_type", 415, "Upload an image, a video or an audio file (not SVG).")
  }
  const poster = upload.poster ? await findMedia(upload.poster) : undefined
  if (upload.poster && poster?.kind !== "image") {
    throw new DomainError("invalid_poster", 422, "The poster must be an uploaded image.")
  }

  const id = crypto.randomUUID()
  const object = await env.MEDIA.put(id, upload.body, { httpMetadata: { contentType } })
  const [row] = await db()
    .insert(media)
    .values({
      id,
      kind,
      name: upload.name,
      contentType,
      size: object.size,
      key: id,
      posterId: poster?.id,
      durationSeconds: upload.duration,
    })
    .returning()
  return toMediaDto(row, poster, baseUrl)
}

export function findMedia(id: string) {
  return db().query.media.findFirst({ where: eq(media.id, id) })
}

function toMediaDto(row: MediaRow, poster: MediaRow | undefined, baseUrl: string): Media {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    url: mediaUrl(row, baseUrl),
    posterUrl: poster ? mediaUrl(poster, baseUrl) : null,
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The name only makes the URL readable and names downloads; the id finds the file. */
function mediaUrl(row: MediaRow, baseUrl: string) {
  return `${baseUrl}/media/${row.id}/${encodeURIComponent(row.name)}`
}
