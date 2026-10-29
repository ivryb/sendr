import { AwsClient } from "aws4fetch"
import { z } from "zod"

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
                Html: email.html === null ? undefined : { Data: email.html, Charset: "UTF-8" },
                // An HTML-only email has no text part; SES rejects an empty one.
                Text: email.text ? { Data: email.text, Charset: "UTF-8" } : undefined,
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
      const body = await response.text()
      if (type && PERMANENT_ERRORS.has(type)) {
        // Shown to admins and API callers, so only SES's own explanation, not the raw reply.
        throw new PermanentSendError(readMessage(body) ?? `SES rejected the email (${type}).`)
      }
      throw new Error(`SES ${response.status} ${type ?? ""}: ${body}`)
    },
  }
}

function readMessage(body: string) {
  try {
    return (JSON.parse(body) as { message?: string }).message
  } catch {
    return undefined
  }
}

/** What SNS posts to the webhook: a subscription to confirm, or a notification carrying an event. */
const snsMessage = z.object({
  Type: z.string(),
  TopicArn: z.string().optional(),
  SubscribeURL: z.url().optional(),
  Message: z.string().optional(),
})

const sesEvent = z.object({
  eventType: z.string(),
  mail: z.object({ messageId: z.string().min(1) }),
  bounce: z.object({ bounceType: z.string() }).optional(),
})

/** Reads the body SNS posts, or null when it isn't an SNS message. */
export function parseSnsMessage(body: string) {
  return parseJson(body, snsMessage)
}

/**
 * Reads the SES event in an SNS notification's message, or null for one Sendr doesn't act on.
 * Only permanent bounces count: transient ones are retried by SES itself.
 */
export function parseSesEvent(message: string): ProviderEvent | null {
  const event = parseJson(message, sesEvent)
  if (!event) return null
  const providerMessageId = event.mail.messageId
  switch (event.eventType) {
    case "Delivery":
      return { type: "delivered", providerMessageId }
    case "Bounce":
      return event.bounce?.bounceType === "Permanent" ? { type: "bounced", providerMessageId } : null
    case "Complaint":
      return { type: "complained", providerMessageId }
    default:
      return null
  }
}

function parseJson<T extends z.ZodType>(text: string, schema: T): z.infer<T> | null {
  try {
    return schema.safeParse(JSON.parse(text)).data ?? null
  } catch {
    return null
  }
}
