import { eq } from "drizzle-orm"

import type { Settings } from "../../shared/model"
import { db } from "../db/client"
import { settings } from "../db/schema"
import { randomToken } from "./crypto"

const SETTINGS_ID = 1

export type InstanceSettings = typeof settings.$inferSelect

/** Reads the settings row, creating it with fresh secrets on the instance's first request. */
export async function getSettings(): Promise<InstanceSettings> {
  const existing = await db().query.settings.findFirst()
  if (existing) return existing
  await db()
    .insert(settings)
    .values({
      id: SETTINGS_ID,
      secret: randomToken(),
      webhookSecret: randomToken(24),
    })
    .onConflictDoNothing()
  return (await db().query.settings.findFirst())!
}

export async function updateSettings(
  values: Partial<Omit<InstanceSettings, "id" | "secret">>
) {
  await getSettings()
  await db().update(settings).set(values).where(eq(settings.id, SETTINGS_ID))
  return getSettings()
}

export function toSettingsDto(row: InstanceSettings): Settings {
  return {
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    replyTo: row.replyTo,
    footer: row.footer,
    publicUrl: row.publicUrl,
    webhookSecret: row.webhookSecret,
  }
}

/** "Evan <evan@example.com>" when a name is set. */
export function senderAddress(row: InstanceSettings) {
  return row.fromName ? `${row.fromName} <${row.fromEmail}>` : row.fromEmail
}
