import { DomainError } from "../lib/errors"

export type OutgoingEmail = {
  from: string
  to: string
  replyTo?: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
}

export type ProviderEvent = {
  type: "delivered" | "bounced" | "complained"
  providerMessageId: string
}

/**
 * Everything Sendr needs from an email service. Rendering, tracking, unsubscribe and pacing
 * are provider-independent; a new service only implements this.
 */
export interface EmailProvider {
  maxSendsPerSecond: number
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>
}

/**
 * The provider refused this one email (bad address, rejected content); retrying won't help.
 * Its message is the provider's own reason, so the API shows it as a 422.
 */
export class PermanentSendError extends DomainError {
  constructor(message: string) {
    super("rejected", 422, message)
  }
}
