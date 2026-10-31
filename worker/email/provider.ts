import type { EmailReport } from "../../shared/model"
import { DomainError } from "../lib/errors"

export type OutgoingEmail = {
  from: string
  /** Everyone on `to` and `cc` sees each other. */
  to: string[]
  cc?: string[]
  replyTo?: string
  subject: string
  /** Null sends a text-only email. */
  html: string | null
  text: string
  headers?: Record<string, string>
}

export type ProviderEvent = {
  type: EmailReport
  providerMessageId: string
  /** Who the event is about: an email to several people gets a report for each. */
  recipients: string[]
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
