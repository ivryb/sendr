import { and, desc, eq, like, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"

import type { Contact, ContactStatus } from "../../shared/model"
import { db } from "../db/client"
import { contacts } from "../db/schema"

export const contactInput = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
  firstName: z.string().trim().max(200).nullish(),
  fields: z.record(z.string(), z.string()).optional(),
  // Only `true` has an effect: host apps may unsubscribe a contact but never resubscribe one.
  unsubscribed: z.boolean().optional(),
})
export type ContactInput = z.infer<typeof contactInput>

export type UpsertResult = { ok: true } | { ok: false; error: "email_taken" }

export async function upsertContact(
  externalId: string,
  input: ContactInput
): Promise<UpsertResult> {
  const [byExternalId, byEmail] = await Promise.all([
    db().query.contacts.findFirst({ where: eq(contacts.externalId, externalId) }),
    db().query.contacts.findFirst({ where: eq(contacts.email, input.email) }),
  ])
  if (byEmail?.externalId && byEmail.externalId !== externalId) {
    return { ok: false, error: "email_taken" }
  }

  const existing = byExternalId ?? byEmail
  const unsubscribe =
    input.unsubscribed && (!existing || existing.status === "subscribed")
  const values = {
    externalId,
    email: input.email,
    ...(input.firstName !== undefined && { firstName: input.firstName }),
    ...(input.fields && { fields: input.fields }),
    ...(unsubscribe && {
      status: "unsubscribed" as const,
      statusChangedAt: new Date(),
    }),
  }

  if (existing) {
    await db().update(contacts).set(values).where(eq(contacts.id, existing.id))
  } else {
    await db().insert(contacts).values(values)
  }
  return { ok: true }
}

export async function deleteContact(externalId: string) {
  await db().delete(contacts).where(eq(contacts.externalId, externalId))
}

export async function listContacts(filter: {
  q?: string
  status?: ContactStatus
  limit?: number
  offset?: number
}) {
  const conditions: SQL[] = []
  if (filter.status) conditions.push(eq(contacts.status, filter.status))
  if (filter.q) {
    const pattern = `%${filter.q.toLowerCase()}%`
    conditions.push(
      or(
        like(contacts.email, pattern),
        like(sql`lower(${contacts.firstName})`, pattern),
        like(contacts.externalId, pattern)
      )!
    )
  }
  const where = conditions.length ? and(...conditions) : undefined
  const [rows, [{ total }]] = await Promise.all([
    db()
      .select()
      .from(contacts)
      .where(where)
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0),
    db().select({ total: sql<number>`count(*)` }).from(contacts).where(where),
  ])
  return { contacts: rows.map(toContactDto), total }
}

export async function contactCounts() {
  const rows = await db()
    .select({ status: contacts.status, count: sql<number>`count(*)` })
    .from(contacts)
    .groupBy(contacts.status)
  return Object.fromEntries(rows.map((row) => [row.status, row.count]))
}

/**
 * Changes a contact's status on the operator's or the recipient's request. With `onlyFrom`,
 * nothing changes unless the contact currently has that status.
 */
export async function setContactStatus(
  id: string,
  status: "subscribed" | "unsubscribed",
  onlyFrom?: ContactStatus
) {
  await db()
    .update(contacts)
    .set({ status, statusChangedAt: new Date() })
    .where(and(eq(contacts.id, id), onlyFrom && eq(contacts.status, onlyFrom)))
}

function toContactDto(row: typeof contacts.$inferSelect): Contact {
  return {
    id: row.id,
    externalId: row.externalId,
    email: row.email,
    firstName: row.firstName,
    fields: row.fields,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }
}
