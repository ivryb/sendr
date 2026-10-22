import { env } from "cloudflare:workers"

import type { SenderRow } from "../db/schema"
import type { EmailProvider, OutgoingEmail } from "./provider"
import { CONFIGURATION_SET } from "./ses-account"
import { sesProvider } from "./ses"

/** Emails accepted by the "memory" provider, for tests and local development. */
export const memoryOutbox: OutgoingEmail[] = []

const memory: EmailProvider = {
  maxSendsPerSecond: Infinity,
  async send(email) {
    memoryOutbox.push(email)
    console.log(`[memory email] to ${email.to}: ${email.subject}`)
    return { providerMessageId: `memory-${crypto.randomUUID()}` }
  },
}

/** With EMAIL_PROVIDER set to "memory" (tests, local development), emails are printed, not sent. */
export function memoryProvider() {
  return env.EMAIL_PROVIDER === "memory" ? memory : null
}

/** The service that sends a sender's emails. */
export function senderProvider(sender: SenderRow): EmailProvider {
  const memory = memoryProvider()
  if (memory) return memory
  return sesProvider({
    accessKeyId: sender.accessKeyId,
    secretAccessKey: sender.secretAccessKey,
    region: sender.region,
    configurationSet: CONFIGURATION_SET,
    maxSendsPerSecond: sender.maxSendRate,
  })
}
