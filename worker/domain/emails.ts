import { and, eq, inArray, or } from "drizzle-orm"
import { z } from "zod"

import type { Email } from "../../shared/model"
import { renderMessage } from "../../shared/render"
import { db } from "../db/client"
import { contacts, emails, senders } from "../db/schema"
import { PermanentSendError } from "../email/provider"
import { senderProvider } from "../email/providers"
import { DomainError } from "../lib/errors"

export const emailInput = z
  .object({
    /** A sender's ID or address. */
    from: z.string().trim().min(1),
    to: z.email().transform((email) => email.trim().toLowerCase()),
    subject: z.string().trim().min(1).max(998),
    markdown: z.string().optional(),
    html: z.string().optional(),
    /** Plain-text version for `html`; Sendr uses `markdown` as text when given. */
    text: z.string().optional(),
    replyTo: z.email().optional(),
  })
  .refine((input) => input.markdown || input.html, {
    message: "Add the message as `markdown` or `html`.",
    path: ["markdown"],
  })

/**
 * Sends one email right away, outside any campaign: no footer, no unsubscribe link. Addresses
 * that bounced or complained before are refused, because mailing them again hurts the
 * sender's reputation with SES.
 */
export async function sendSingleEmail(input: z.infer<typeof emailInput>) {
  const sender = await db().query.senders.findFirst({
    where: or(eq(senders.id, input.from), eq(senders.email, input.from.toLowerCase())),
  })
  if (!sender) throw new DomainError("unknown_sender", 422, `No sender is set up for ${input.from}.`)
  if (!sender.verified) {
    throw new DomainError("sender_not_ready", 422, `${sender.email} isn't verified yet. Finish its setup in Senders.`)
  }
  if (await isSuppressed(input.to)) {
    throw new DomainError("suppressed", 422, `${input.to} bounced or reported spam before, so Sendr won't email it.`)
  }

  const content = input.html
    ? { subject: input.subject, html: input.html, text: input.text ?? "" }
    : renderMessage({ subject: input.subject, markdown: input.markdown! })
  const [row] = await db()
    .insert(emails)
    .values({ senderId: sender.id, to: input.to, subject: input.subject, status: "sent" })
    .returning()
  try {
    const { providerMessageId } = await senderProvider(sender).send({
      replyTo: input.replyTo,
      to: input.to,
      ...content,
    })
    await db().update(emails).set({ providerMessageId }).where(eq(emails.id, row.id))
    return toEmailDto(row)
  } catch (error) {
    if (!(error instanceof PermanentSendError)) {
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
    return toEmailDto(failed)
  }
}

export async function getEmail(id: string) {
  const row = await db().query.emails.findFirst({ where: eq(emails.id, id) })
  if (!row) throw new DomainError("not_found", 404, "Email not found.")
  return toEmailDto(row)
}

async function isSuppressed(address: string) {
  const blocked = ["bounced", "complained"] as const
  const [contact, email] = await Promise.all([
    db().query.contacts.findFirst({
      columns: { id: true },
      where: and(eq(contacts.email, address), inArray(contacts.status, blocked)),
    }),
    db().query.emails.findFirst({
      columns: { id: true },
      where: and(eq(emails.to, address), inArray(emails.status, blocked)),
    }),
  ])
  return Boolean(contact || email)
}

function toEmailDto(row: typeof emails.$inferSelect): Email {
  return {
    id: row.id,
    senderId: row.senderId,
    to: row.to,
    subject: row.subject,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  }
}
