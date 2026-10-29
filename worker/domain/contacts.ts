import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
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

/** A contact to add or update: keyed by the host's user ID when it has one, otherwise by email. */
export type ContactUpsert = ContactInput & { externalId?: string }
export type UpsertResult = { ok: true } | { ok: false; error: "email_taken" }

type ContactRow = typeof contacts.$inferSelect

/** D1 binds at most 100 parameters per statement. */
const LOOKUP_CHUNK = 50
const INSERT_CHUNK = 11

export async function upsertContact(externalId: string, input: ContactInput) {
  const [result] = await upsertContacts([{ ...input, externalId }])
  return result
}

/**
 * Adds or updates contacts in order, as if one at a time, in a few queries: Workers Free allows
 * 50 D1 queries per request, and a batch can hold 1,000 contacts.
 */
export async function upsertContacts(batch: ContactUpsert[]): Promise<UpsertResult[]> {
  const index = await loadIndex(batch)
  const created = new Set<ContactRow>()
  const changed = new Set<ContactRow>()
  const results = batch.map((item) => {
    const result = applyUpsert(index, item)
    if (result.ok) (result.created ? created : changed).add(result.row)
    return result.ok ? { ok: true as const } : result
  })
  await save([...changed].filter((row) => !created.has(row)), [...created])
  return results
}

type Index = { byEmail: Map<string, ContactRow>; byExternalId: Map<string, ContactRow> }

async function loadIndex(batch: ContactUpsert[]): Promise<Index> {
  const chunks = []
  for (let i = 0; i < batch.length; i += LOOKUP_CHUNK) chunks.push(batch.slice(i, i + LOOKUP_CHUNK))
  const rows = await Promise.all(
    chunks.map((chunk) => {
      const externalIds = chunk.flatMap((item) => (item.externalId ? [item.externalId] : []))
      return db()
        .select()
        .from(contacts)
        .where(
          or(
            inArray(contacts.email, chunk.map((item) => item.email)),
            externalIds.length ? inArray(contacts.externalId, externalIds) : undefined
          )
        )
    })
  )
  const index: Index = { byEmail: new Map(), byExternalId: new Map() }
  for (const row of rows.flat()) addToIndex(index, row)
  return index
}

function addToIndex(index: Index, row: ContactRow) {
  index.byEmail.set(row.email, row)
  if (row.externalId) index.byExternalId.set(row.externalId, row)
}

function applyUpsert(
  index: Index,
  { externalId, ...input }: ContactUpsert
): { ok: true; row: ContactRow; created: boolean } | { ok: false; error: "email_taken" } {
  const byEmail = index.byEmail.get(input.email)
  const existing = (externalId && index.byExternalId.get(externalId)) || byEmail
  // An address held by another contact stays theirs, even one imported without a user ID: moving
  // a user onto it would break the unique email.
  const taken =
    byEmail &&
    (byEmail !== existing || (externalId && byEmail.externalId && byEmail.externalId !== externalId))
  if (taken) return { ok: false, error: "email_taken" }

  // A bounce belongs to the address, so a corrected email can get mail again. Unsubscribes and
  // complaints belong to the person and stay.
  const newAddress = existing?.status === "bounced" && existing.email !== input.email
  const status: ContactStatus | undefined =
    input.unsubscribed && (!existing || existing.status === "subscribed" || newAddress)
      ? "unsubscribed"
      : newAddress
        ? "subscribed"
        : undefined

  const now = new Date()
  const row: ContactRow = existing ?? {
    id: crypto.randomUUID(),
    externalId: null,
    email: input.email,
    firstName: null,
    fields: {},
    status: "subscribed",
    statusChangedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  if (existing && existing.email !== input.email) index.byEmail.delete(existing.email)
  row.email = input.email
  if (externalId) row.externalId = externalId
  if (input.firstName !== undefined) row.firstName = input.firstName
  if (input.fields) row.fields = input.fields
  if (status) Object.assign(row, { status, statusChangedAt: now })
  addToIndex(index, row)
  return { ok: true, row, created: !existing }
}

/** Updates run first, so an address an existing contact moved away from is free to insert. */
async function save(updated: ContactRow[], created: ContactRow[]) {
  const statements: BatchItem<"sqlite">[] = updated.map(
    ({ id, externalId, email, firstName, fields, status, statusChangedAt }) =>
      db()
        .update(contacts)
        .set({ externalId, email, firstName, fields, status, statusChangedAt })
        .where(eq(contacts.id, id))
  )
  for (let i = 0; i < created.length; i += INSERT_CHUNK) {
    statements.push(db().insert(contacts).values(created.slice(i, i + INSERT_CHUNK)))
  }
  const [first, ...rest] = statements
  if (first) await db().batch([first, ...rest])
}

/**
 * Removes the contact for a deleted user. One who unsubscribed, bounced or complained is kept,
 * detached from the user ID, so signing up again with that address can't undo their opt-out.
 */
export async function deleteContact(externalId: string) {
  const contact = await db().query.contacts.findFirst({
    where: eq(contacts.externalId, externalId),
  })
  if (!contact) return
  if (contact.status === "subscribed") {
    await db().delete(contacts).where(eq(contacts.id, contact.id))
  } else {
    await db()
      .update(contacts)
      .set({ externalId: null, firstName: null, fields: {} })
      .where(eq(contacts.id, contact.id))
  }
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
  const counts: Record<ContactStatus, number> = {
    subscribed: 0,
    unsubscribed: 0,
    bounced: 0,
    complained: 0,
  }
  for (const row of rows) counts[row.status] = row.count
  return counts
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
