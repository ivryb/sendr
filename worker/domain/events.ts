import { and, eq } from "drizzle-orm"

import { db } from "../db/client"
import { contacts, deliveries, emails } from "../db/schema"
import type { ProviderEvent } from "../email/provider"
import { suppressContact } from "./contacts"

/**
 * Records provider feedback on campaign deliveries and single emails. Bounces and complaints
 * also stop future campaigns to that contact.
 */
export async function applyProviderEvent({ type, providerMessageId }: ProviderEvent) {
  const database = db()
  if (type === "delivered") {
    // Only promote "sent": a bounce or complaint can arrive before the delivery event.
    await database.batch([
      database
        .update(deliveries)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(and(eq(deliveries.providerMessageId, providerMessageId), eq(deliveries.status, "sent"))),
      database
        .update(emails)
        .set({ status: "delivered" })
        .where(and(eq(emails.providerMessageId, providerMessageId), eq(emails.status, "sent"))),
    ])
    return
  }

  const [[delivery], [email]] = await database.batch([
    database
      .update(deliveries)
      .set({ status: type })
      .where(eq(deliveries.providerMessageId, providerMessageId))
      .returning({ contactId: deliveries.contactId }),
    database
      .update(emails)
      .set({ status: type })
      .where(eq(emails.providerMessageId, providerMessageId))
      .returning({ to: emails.to }),
  ])
  const contact = delivery?.contactId
    ? eq(contacts.id, delivery.contactId)
    : email && eq(contacts.email, email.to)
  if (contact) await suppressContact(contact, type)
}
