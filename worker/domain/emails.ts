import { and, eq, getTableColumns, inArray, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"

import { EMAIL_RECIPIENTS_MAX, SUBJECT_MAX, type Email } from "../../shared/model"
import { renderMessage } from "../../shared/render"
import { chunked, db, MAX_PARAMETERS } from "../db/client"
import { contacts, emailRecipients, emails, senders } from "../db/schema"
import { PermanentSendError } from "../email/provider"
import { senderProvider } from "../email/providers"
import { DomainError } from "../lib/errors"

const RECIPIENTS_PER_INSERT = Math.floor(MAX_PARAMETERS / Object.keys(getTableColumns(emailRecipients)).length)

const address = z.email().transform((email) => email.trim().toLowerCase())
/** One address, or several. */
const addresses = z.union([address.transform((email) => [email]), z.array(address)])

const message = z.union(
  [
    // Listed first, so `html` wins when both are sent.
    z.object({
      html: z.string().min(1),
      /** Plain-text version of `html`. */
      text: z.string().optional(),
    }),
    // Laid out like a campaign, and sent as the text part too.
    z.object({ markdown: z.string().min(1) }),
  ],
  { error: "Add the message as `markdown` or `html`." }
)

export const emailInput = z
  .object({
    /** A sender's ID or address. */
    from: z.string().trim().min(1),
    to: addresses.refine((to) => to.length > 0, { error: "Add at least one address to `to`." }),
    cc: addresses.default([]),
    subject: z.string().trim().min(1).max(SUBJECT_MAX),
    replyTo: z.email().optional(),
  })
  .and(message)
  .refine(({ to, cc }) => to.length + cc.length <= EMAIL_RECIPIENTS_MAX, {
    error: `An email can go to at most ${EMAIL_RECIPIENTS_MAX} people, \`to\` and \`cc\` together.`,
  })

/**
 * Sends one email right away, outside any campaign: no footer, no unsubscribe link. Addresses
 * that bounced or complained before are refused, because mailing them again hurts the
 * sender's reputation with SES. A repeat with an earlier `idempotencyKey` gets that email
 * back and sends nothing.
 */
export async function sendSingleEmail(input: z.infer<typeof emailInput>, idempotencyKey?: string) {
  const earlier = idempotencyKey && (await findEmail(eq(emails.idempotencyKey, idempotencyKey)))
  if (earlier) return earlier

  const sender = await db().query.senders.findFirst({
    where: or(eq(senders.id, input.from), eq(senders.email, input.from.toLowerCase())),
  })
  if (!sender) throw new DomainError("unknown_sender", 422, `No sender is set up for ${input.from}.`)
  if (!sender.verified) {
    throw new DomainError("sender_not_ready", 422, `${sender.email} isn't verified yet. Finish its setup in Senders.`)
  }
  // Each address once: one in both `to` and `cc` stays in `to`.
  const to = [...new Set(input.to)]
  const cc = [...new Set(input.cc)].filter((email) => !to.includes(email))
  const blocked = await suppressed([...to, ...cc])
  if (blocked.length > 0) {
    throw new DomainError(
      "suppressed",
      422,
      `${blocked.join(", ")} bounced or reported spam before, so Sendr won't email ${blocked.length > 1 ? "them" : "it"}.`
    )
  }

  const content =
    "html" in input
      ? { subject: input.subject, html: input.html, text: input.text ?? "" }
      : renderMessage({ subject: input.subject, markdown: input.markdown })
  const emailId = crypto.randomUUID()
  const recipientRows = [
    ...to.map((email) => ({ emailId, email, field: "to" as const, report: null })),
    ...cc.map((email) => ({ emailId, email, field: "cc" as const, report: null })),
  ]
  // One batch, so a failed insert leaves no email holding the idempotency key.
  const database = db()
  const [[row]] = await database.batch([
    database
      .insert(emails)
      .values({ id: emailId, senderId: sender.id, subject: input.subject, status: "sent", idempotencyKey })
      .returning(),
    ...chunked(recipientRows, RECIPIENTS_PER_INSERT).map((rows) => database.insert(emailRecipients).values(rows)),
  ])
  try {
    const { providerMessageId } = await senderProvider(sender).send({ replyTo: input.replyTo, to, cc, ...content })
    await db().update(emails).set({ providerMessageId }).where(eq(emails.id, row.id))
    return toEmailDto(row, recipientRows)
  } catch (error) {
    if (!(error instanceof PermanentSendError)) {
      // Deletes its recipients too, and frees the idempotency key for the caller's retry.
      await db().delete(emails).where(eq(emails.id, row.id))
      console.error("Single email send failed", error)
      throw new DomainError(
        "send_failed",
        503,
        "The email service didn't take the email right now (it may be busy or paused). Nothing was sent; try again shortly."
      )
    }
    const [failed] = await db()
      .update(emails)
      .set({ status: "failed", error: error.message })
      .where(eq(emails.id, row.id))
      .returning()
    return toEmailDto(failed, recipientRows)
  }
}

export async function getEmail(id: string) {
  const email = await findEmail(eq(emails.id, id))
  if (!email) throw new DomainError("not_found", 404, "Email not found.")
  return email
}

async function findEmail(where: SQL) {
  const row = await db().query.emails.findFirst({ where })
  if (!row) return undefined
  const recipients = await db()
    .select()
    .from(emailRecipients)
    .where(eq(emailRecipients.emailId, row.id))
    .orderBy(sql`rowid`)
  return toEmailDto(row, recipients)
}

/** The addresses among `addresses` that bounced or complained before. */
async function suppressed(addresses: string[]) {
  const blocked = ["bounced", "complained"] as const
  const [contactRows, recipientRows] = await Promise.all([
    db()
      .select({ email: contacts.email })
      .from(contacts)
      .where(and(inArray(contacts.email, addresses), inArray(contacts.status, blocked))),
    db()
      .select({ email: emailRecipients.email })
      .from(emailRecipients)
      .where(and(inArray(emailRecipients.email, addresses), inArray(emailRecipients.report, blocked))),
  ])
  return [...new Set([...contactRows, ...recipientRows].map(({ email }) => email))]
}

function toEmailDto(
  row: typeof emails.$inferSelect,
  recipients: (typeof emailRecipients.$inferSelect)[]
): Email {
  return {
    id: row.id,
    senderId: row.senderId,
    subject: row.subject,
    status: row.status,
    recipients: recipients.map(({ email, field, report }) => ({ email, field, status: report ?? row.status })),
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  }
}
