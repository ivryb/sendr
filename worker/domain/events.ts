import { and, eq, inArray, isNull } from "drizzle-orm"

import { db } from "../db/client"
import { contacts, deliveries, emailRecipients, emails } from "../db/schema"
import type { ProviderEvent } from "../email/provider"
import { suppressContact } from "./contacts"

/**
 * Records provider feedback on campaign deliveries and single emails. Bounces and complaints
 * also stop future campaigns to that contact.
 */
export async function applyProviderEvent({ type, providerMessageId, recipients }: ProviderEvent) {
  const database = db()
  const reported = and(
    inArray(
      emailRecipients.emailId,
      database.select({ id: emails.id }).from(emails).where(eq(emails.providerMessageId, providerMessageId))
    ),
    inArray(emailRecipients.email, recipients)
  )
  if (type === "delivered") {
    // Only promote "sent": a bounce or complaint can arrive before the delivery event.
    await database.batch([
      database
        .update(deliveries)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(and(eq(deliveries.providerMessageId, providerMessageId), eq(deliveries.status, "sent"))),
      database
        .update(emailRecipients)
        .set({ report: "delivered" })
        .where(and(reported, isNull(emailRecipients.report))),
    ])
    return
  }

  const [[delivery], emailed] = await database.batch([
    database
      .update(deliveries)
      .set({ status: type })
      .where(eq(deliveries.providerMessageId, providerMessageId))
      .returning({ contactId: deliveries.contactId }),
    database
      .update(emailRecipients)
      .set({ report: type })
      .where(reported)
      .returning({ email: emailRecipients.email }),
  ])
  const contact = delivery?.contactId
    ? eq(contacts.id, delivery.contactId)
    : emailed.length > 0 && inArray(contacts.email, emailed.map(({ email }) => email))
  if (contact) await suppressContact(contact, type)
}
