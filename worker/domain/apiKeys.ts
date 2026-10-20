import { desc, eq } from "drizzle-orm"

import type { ApiKey, ApiKeyAccess } from "../../shared/model"
import { db } from "../db/client"
import { apiKeys } from "../db/schema"
import { randomToken, sha256 } from "../lib/crypto"

/** Creates a key and returns its secret; only a hash is stored, so this is the one chance to see it. */
export async function createApiKey(name: string, access: ApiKeyAccess) {
  const key = `sk_${randomToken(24)}`
  await db()
    .insert(apiKeys)
    .values({ name, access, prefix: key.slice(0, 7), hash: await sha256(key) })
  return key
}

export async function findApiKey(key: string) {
  return db().query.apiKeys.findFirst({
    where: eq(apiKeys.hash, await sha256(key)),
  })
}

export async function touchApiKey(id: string) {
  await db().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id))
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const rows = await db().select().from(apiKeys).orderBy(desc(apiKeys.createdAt))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    access: row.access,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }))
}

export async function deleteApiKey(id: string) {
  await db().delete(apiKeys).where(eq(apiKeys.id, id))
}
