import { env } from "cloudflare:workers"

import type { EmailProvider, OutgoingEmail } from "./provider"
import { sesProvider } from "./ses"

/** Emails accepted by the "memory" provider, for tests and local development. */
export const memoryOutbox: OutgoingEmail[] = []

const PROVIDERS: Record<string, () => EmailProvider> = {
  ses: () =>
    sesProvider({
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      region: env.AWS_REGION,
      configurationSet: env.SES_CONFIGURATION_SET,
      maxSendsPerSecond: Number(env.SES_MAX_SENDS_PER_SECOND) || 1,
    }),
  cloudflare: () => ({
    maxSendsPerSecond: 10,
    async send(email) {
      const { messageId } = await env.EMAIL.send(email)
      return { providerMessageId: messageId }
    },
  }),
  memory: () => ({
    maxSendsPerSecond: Infinity,
    async send(email) {
      memoryOutbox.push(email)
      return { providerMessageId: `memory-${crypto.randomUUID()}` }
    },
  }),
}

/** Resolves a provider named in configuration (EMAIL_PROVIDER, AUTH_EMAIL_PROVIDER). */
export function emailProvider(name: string): EmailProvider {
  const create = PROVIDERS[name]
  if (!create) {
    throw new Error(
      `Unknown email provider "${name}". Use one of: ${Object.keys(PROVIDERS).join(", ")}`
    )
  }
  return create()
}
