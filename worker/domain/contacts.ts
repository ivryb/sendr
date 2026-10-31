import { and, desc, eq, getTableColumns, inArray, like, ne, or, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { z } from "zod"

import type { Contact, ContactStatus } from "../../shared/model"
import { chunked, db, MAX_PARAMETERS } from "../db/client"
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

const LOOKUP_CHUNK = MAX_PARAMETERS / 2
const INSERT_CHUNK = Math.floor(MAX_PARAMETERS / Object.keys(getTableColumns(contacts)).length)

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
  deleted: Set<ContactRow>
}

async function loadIndex(batch: ContactUpsert[]): Promise<Index> {
  const database = db()
  const rows = await Promise.all(
    chunked(batch, LOOKUP_CHUNK).map((chunk) => {
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
    deleted: new Set(),
  }
  for (const row of rows.flat()) addToIndex(index, row)
  return index
}

function addToIndex(index: Index, row: ContactRow) {
  index.byEmail.set(row.email, row)
  if (row.externalId) index.byExternalId.set(row.externalId, row)
}

// When two statuses meet at one address, the stricter stays. An unsubscribe outranks a bounce
// because it must survive the contact's next move, which clears a bounce.
const STRICTNESS: Record<ContactStatus, number> = {
  subscribed: 0,
  bounced: 1,
  unsubscribed: 2,
  complained: 3,
}

function applyUpsert(index: Index, { externalId, ...input }: ContactUpsert): UpsertResult {
  const byEmail = index.byEmail.get(input.email)
  const existing = (externalId && index.byExternalId.get(externalId)) || byEmail
  // An opt-out left behind at an address belongs to no one, so a contact moving there takes it
  // over: usually the same person moving back from a typo, who would otherwise be locked out.
  // Late reports for the old row's emails then find no contact, which is fine: the stricter
  // status is kept, and SES suppresses an address that bounced or complained itself.
  const left = byEmail && byEmail !== existing && isLeftBehind(byEmail) ? byEmail : undefined
  // Any other address held by another contact stays theirs, even one imported without a user
  // ID: moving a user onto it would break the unique email.
  const taken =
    byEmail &&
    !left &&
    (byEmail !== existing || (externalId && byEmail.externalId && byEmail.externalId !== externalId))
  if (taken) return { ok: false, error: "email_taken" }

  const now = new Date()
  const moves = existing && existing.email !== input.email
  // A bounce belongs to the address, so a corrected email can get mail again. Unsubscribes and
  // complaints belong to the person and stay. A bounce left at the address they move to stays
  // too, since that address bounced.
  const fresh = { status: "subscribed", statusChangedAt: now } as const
  const kept = !existing || (moves && existing.status === "bounced") ? fresh : existing
  const merged = left && STRICTNESS[left.status] > STRICTNESS[kept.status] ? left : kept
  const optOut = input.unsubscribed && merged.status === "subscribed"
  const { status, statusChangedAt } = optOut ? { status: "unsubscribed", statusChangedAt: now } : merged

  if (left) dropRow(index, left)
  if (moves) leaveAddress(index, existing, now)
  const row = existing ?? newRow(input.email, now)
  row.email = input.email
  if (externalId) row.externalId = externalId
  if (input.firstName !== undefined) row.firstName = input.firstName
  if (input.fields) row.fields = input.fields
  if (status !== row.status) {
    Object.assign(row, { status, statusChangedAt })
    index.statusChanged.add(row)
  }
  addToIndex(index, row)
  ;(existing ? index.changed : index.created).add(row)
  return { ok: true }
}

function newRow(email: string, now: Date): ContactRow {
  return {
    id: crypto.randomUUID(),
    externalId: null,
    email,
    firstName: null,
    fields: {},
    status: "subscribed",
    statusChangedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Frees the address a contact moves away from. If the contact unsubscribed, bounced or
 * complained, a detached row keeps that status at the old address, as `deleteContact` does:
 * otherwise adding the address again, even later in the same call, would subscribe it afresh.
 */
function leaveAddress(index: Index, contact: ContactRow, now: Date) {
  index.byEmail.delete(contact.email)
  if (contact.status === "subscribed") return
  const { status, statusChangedAt } = contact
  const detached = { ...newRow(contact.email, now), status, statusChangedAt }
  addToIndex(index, detached)
  index.created.add(detached)
}

/** A row that only keeps an opt-out at its address, as `leaveAddress` and `deleteContact` leave it. */
/**
 * A row `leaveAddress` or `deleteContact` kept only for its opt-out. A contact imported by email
 * has a name or fields and stays its own contact, even when it's opted out.
 */
function isLeftBehind(row: ContactRow) {
  return (
    !row.externalId &&
    row.status !== "subscribed" &&
    row.firstName === null &&
    !Object.keys(row.fields).length
  )
}

/** Takes a row out of the call; one already stored is deleted. */
function dropRow(index: Index, row: ContactRow) {
  index.byEmail.delete(row.email)
  index.changed.delete(row)
  index.statusChanged.delete(row)
  if (!index.created.delete(row)) index.deleted.add(row)
}

/**
 * Deletes run first and updates next, so the address of a row taken over, or one an existing
 * contact moved away from, is free to use. A deleted row's deliveries stay in campaign counts
 * without a contact, as for `deleteContact`.
 */
async function save({ created, changed, statusChanged, deleted }: Index) {
  const database = db()
  const statements: BatchItem<"sqlite">[] = []
  for (const rows of chunked([...deleted], MAX_PARAMETERS)) {
    statements.push(database.delete(contacts).where(inArray(contacts.id, rows.map((row) => row.id))))
  }
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
  for (const rows of chunked([...created], INSERT_CHUNK)) {
    statements.push(database.insert(contacts).values(rows))
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

/**
 * Stops campaigns to the contacts `where` matches after the provider reports a bounce or a spam
 * complaint. A bounce only replaces "subscribed": it belongs to the address, and a later email
 * change resubscribes the contact, so it must never stand in for an opt-out or a complaint. A
 * complaint replaces an unsubscribe and a bounce too, because it belongs to the person: their
 * single emails stop as well, and no email change or resubscribe link undoes it.
 */
export async function suppressContact(where: SQL, status: "bounced" | "complained") {
  const replaces =
    status === "bounced" ? eq(contacts.status, "subscribed") : ne(contacts.status, "complained")
  await db()
    .update(contacts)
    .set({ status, statusChangedAt: new Date() })
    .where(and(where, replaces))
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
