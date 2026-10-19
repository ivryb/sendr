import { AwsClient } from "aws4fetch"

import {
  PermanentSendError,
  type EmailProvider,
  type ProviderEvent,
} from "./provider"

type SesOptions = {
  accessKeyId: string
  secretAccessKey: string
  region: string
  configurationSet?: string
  maxSendsPerSecond: number
  fetch?: typeof fetch
}

// Errors about this one message. Account-level errors (paused sending, throttling) are
// retried instead, so a whole campaign isn't marked failed while SES is unavailable.
const PERMANENT_ERRORS = new Set(["MessageRejected", "BadRequestException"])

export function sesProvider(options: SesOptions): EmailProvider {
  const aws = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region,
    service: "ses",
  })
  const endpoint = `https://email.${options.region}.amazonaws.com/v2/email/outbound-emails`
  const send = options.fetch ?? fetch

  return {
    maxSendsPerSecond: options.maxSendsPerSecond,
    async send(email) {
      const request = await aws.sign(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          FromEmailAddress: email.from,
          Destination: { ToAddresses: [email.to] },
          ReplyToAddresses: email.replyTo ? [email.replyTo] : undefined,
          ConfigurationSetName: options.configurationSet || undefined,
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: "UTF-8" },
              Body: {
                Html: { Data: email.html, Charset: "UTF-8" },
                Text: { Data: email.text, Charset: "UTF-8" },
              },
              Headers: Object.entries(email.headers ?? {}).map(
                ([Name, Value]) => ({ Name, Value })
              ),
            },
          },
        }),
      })
      const response = await send(request)
      if (response.ok) {
        const { MessageId } = await response.json<{ MessageId: string }>()
        return { providerMessageId: MessageId }
      }
      const type = response.headers.get("x-amzn-errortype")?.split(":")[0]
      const message = `SES ${response.status} ${type ?? ""}: ${await response.text()}`
      if (type && PERMANENT_ERRORS.has(type)) throw new PermanentSendError(message)
      throw new Error(message)
    },
  }
}

type SesEventDetail = {
  eventType?: string
  mail?: { messageId?: string }
  bounce?: { bounceType?: string }
}

/**
 * Reads SES events delivered by EventBridge (the full event, or just its `detail`).
 * Only permanent bounces count: transient ones are retried by SES itself.
 */
export function parseSesEvents(body: unknown): ProviderEvent[] {
  const items = Array.isArray(body) ? body : [body]
  return items.flatMap((item): ProviderEvent[] => {
    const detail: SesEventDetail = item?.detail ?? item
    const providerMessageId = detail?.mail?.messageId
    if (!providerMessageId) return []
    switch (detail.eventType) {
      case "Delivery":
        return [{ type: "delivered", providerMessageId }]
      case "Bounce":
        return detail.bounce?.bounceType === "Permanent"
          ? [{ type: "bounced", providerMessageId }]
          : []
      case "Complaint":
        return [{ type: "complained", providerMessageId }]
      default:
        return []
    }
  })
}
