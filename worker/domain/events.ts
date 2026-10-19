import { and, eq } from "drizzle-orm"

import { db } from "../db/client"
import { contacts, deliveries } from "../db/schema"
import type { ProviderEvent } from "../email/provider"

/** Records provider feedback; bounces and complaints also stop future campaigns to that contact. */
export async function applyProviderEvents(events: ProviderEvent[]) {
  for (const event of events) {
    const delivery = await db().query.deliveries.findFirst({
      where: eq(deliveries.providerMessageId, event.providerMessageId),
    })
    if (!delivery) continue

    if (event.type === "delivered") {
      // Only promote "sent": a bounce or complaint can arrive before the delivery event.
      await db()
        .update(deliveries)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(and(eq(deliveries.id, delivery.id), eq(deliveries.status, "sent")))
      continue
    }

    await db().update(deliveries).set({ status: event.type }).where(eq(deliveries.id, delivery.id))
    if (delivery.contactId) {
      await db()
        .update(contacts)
        .set({ status: event.type, statusChangedAt: new Date() })
        .where(eq(contacts.id, delivery.contactId))
    }
  }
}
