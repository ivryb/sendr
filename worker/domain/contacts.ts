import { and, desc, eq, getTableColumns, inArray, like, or, sql, type SQL } from "drizzle-orm"
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
export const contactUpsertInput = contactInput.extend({ externalId: z.string().min(1).optional() })
export type ContactUpsert = z.infer<typeof contactUpsertInput>
export type UpsertResult = { ok: true } | { ok: false; error: "email_taken" }

type ContactRow = typeof contacts.$inferSelect

/** D1 binds at most 100 parameters per statement. */
const LOOKUP_CHUNK = 50
const INSERT_CHUNK = Math.floor(100 / Object.keys(getTableColumns(contacts)).length)

/**
 * Adds or updates contacts in order, in a few queries: Workers Free allows 50 D1 queries per
 * request. The results match one call per contact as long as each contact is listed once.
 */
export async function upsertContacts(batch: ContactUpsert[]): Promise<UpsertResult[]> {
  const index = await loadIndex(batch)
  const results = batch.map((item) => applyUpsert(index, item))
  await save(index)
  return results
}

type Index = {
  byEmail: Map<string, ContactRow>
  byExternalId: Map<string, ContactRow>
  created: Set<ContactRow>
  changed: Set<ContactRow>
  statusChanged: Set<ContactRow>
}

async function loadIndex(batch: ContactUpsert[]): Promise<Index> {
  const chunks = []
  for (let i = 0; i < batch.length; i += LOOKUP_CHUNK) chunks.push(batch.slice(i, i + LOOKUP_CHUNK))
  const database = db()
  const rows = await Promise.all(
    chunks.map((chunk) => {
      const externalIds = chunk.flatMap((item) => (item.externalId ? [item.externalId] : []))
      return database
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
  const index: Index = {
    byEmail: new Map(),
    byExternalId: new Map(),
    created: new Set(),
    changed: new Set(),
    statusChanged: new Set(),
  }
  for (const row of rows.flat()) addToIndex(index, row)
  return index
}

function addToIndex(index: Index, row: ContactRow) {
  index.byEmail.set(row.email, row)
  if (row.externalId) index.byExternalId.set(row.externalId, row)
}

function applyUpsert(index: Index, { externalId, ...input }: ContactUpsert): UpsertResult {
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
  if (status) {
    Object.assign(row, { status, statusChangedAt: now })
    index.statusChanged.add(row)
  }
  addToIndex(index, row)
  ;(existing ? index.changed : index.created).add(row)
  return { ok: true }
}

/** Updates run first, so an address an existing contact moved away from is free to insert. */
async function save({ created, changed, statusChanged }: Index) {
  const database = db()
  const statements: BatchItem<"sqlite">[] = []
  for (const row of changed) {
    if (created.has(row)) continue
    const { id, externalId, email, firstName, fields, status, statusChangedAt } = row
    // Only a status this call changed is written, so an unsubscribe, bounce or complaint that
    // lands while a big import runs isn't overwritten with the status read before it.
    const statusChange = statusChanged.has(row) && { status, statusChangedAt }
    statements.push(
      database
        .update(contacts)
        .set({ externalId, email, firstName, fields, ...statusChange })
        .where(eq(contacts.id, id))
    )
  }
  const inserts = [...created]
  for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
    statements.push(database.insert(contacts).values(inserts.slice(i, i + INSERT_CHUNK)))
  }
  const [first, ...rest] = statements
  if (first) await database.batch([first, ...rest])
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
      // rowid keeps the order of contacts added in one call, which share a created_at.
      .orderBy(desc(contacts.createdAt), desc(sql`rowid`))
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
