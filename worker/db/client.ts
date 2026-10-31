import { env } from "cloudflare:workers"
import { drizzle } from "drizzle-orm/d1"

import * as schema from "./schema"

export const db = () => drizzle(env.DB, { schema })

/** D1 binds at most 100 parameters per statement. */
export const MAX_PARAMETERS = 100

/** Splits `items` into runs of `size`, such as rows per insert under MAX_PARAMETERS. */
export function chunked<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}
