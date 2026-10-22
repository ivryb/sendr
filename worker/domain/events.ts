import { and, eq } from "drizzle-orm"

import { db } from "../db/client"
import { contacts, deliveries, emails } from "../db/schema"
import type { ProviderEvent } from "../email/provider"

/**
 * Records provider feedback on campaign deliveries and single emails. Bounces and complaints
 * also stop future campaigns to that contact.
 */
export async function applyProviderEvent(event: ProviderEvent) {
  await applyToDelivery(event)
  await applyToEmail(event)
}

async function applyToDelivery(event: ProviderEvent) {
  const delivery = await db().query.deliveries.findFirst({
    where: eq(deliveries.providerMessageId, event.providerMessageId),
  })
  if (!delivery) return

  if (event.type === "delivered") {
    // Only promote "sent": a bounce or complaint can arrive before the delivery event.
    await db()
      .update(deliveries)
      .set({ status: "delivered", deliveredAt: new Date() })
      .where(and(eq(deliveries.id, delivery.id), eq(deliveries.status, "sent")))
    return
  }

  await db().update(deliveries).set({ status: event.type }).where(eq(deliveries.id, delivery.id))
  if (delivery.contactId) {
    await db()
      .update(contacts)
      .set({ status: event.type, statusChangedAt: new Date() })
      .where(eq(contacts.id, delivery.contactId))
  }
}

async function applyToEmail(event: ProviderEvent) {
  const email = await db().query.emails.findFirst({
    where: eq(emails.providerMessageId, event.providerMessageId),
  })
  if (!email) return

  if (event.type === "delivered") {
    await db()
      .update(emails)
      .set({ status: "delivered" })
      .where(and(eq(emails.id, email.id), eq(emails.status, "sent")))
    return
  }

  await db().update(emails).set({ status: event.type }).where(eq(emails.id, email.id))
  await db()
    .update(contacts)
    .set({ status: event.type, statusChangedAt: new Date() })
    .where(eq(contacts.email, email.to))
}
