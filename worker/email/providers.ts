import { env } from "cloudflare:workers"

import { senderAddress } from "../../shared/model"
import type { SenderRow } from "../db/schema"
import type { EmailProvider, OutgoingEmail } from "./provider"
import { CONFIGURATION_SET } from "./ses-account"
import { sesProvider } from "./ses"

/** Emails accepted by the "memory" provider, for tests and local development. */
export const memoryOutbox: (OutgoingEmail & { providerMessageId: string })[] = []

const memory: EmailProvider = {
  maxSendsPerSecond: Infinity,
  async send(email) {
    const providerMessageId = `memory-${crypto.randomUUID()}`
    memoryOutbox.push({ ...email, providerMessageId })
    console.log(`[memory email] to ${email.to}: ${email.subject}`)
    return { providerMessageId }
  },
}

/** With EMAIL_PROVIDER set to "memory" (tests, local development), emails are printed, not sent. */
export function memoryProvider() {
  return env.EMAIL_PROVIDER === "memory" ? memory : null
}

/** The service that sends a sender's emails, from its address and with its reply-to. */
export function senderProvider(sender: SenderRow) {
  const provider =
    memoryProvider() ??
    sesProvider({
      accessKeyId: sender.accessKeyId,
      secretAccessKey: sender.secretAccessKey,
      region: sender.region,
      configurationSet: CONFIGURATION_SET,
      maxSendsPerSecond: sender.maxSendRate,
    })
  const from = senderAddress(sender)
  return {
    maxSendsPerSecond: provider.maxSendsPerSecond,
    send: (email: Omit<OutgoingEmail, "from">) =>
      provider.send({ ...email, from, replyTo: email.replyTo ?? (sender.replyTo || undefined) }),
  } satisfies EmailProvider
}
