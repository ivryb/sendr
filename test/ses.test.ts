import { describe, expect, it } from "vitest"

import { PermanentSendError } from "../worker/email/provider"
import { parseSesEvents, sesProvider } from "../worker/email/ses"

function providerReplying(response: Response) {
  const requests: Request[] = []
  const provider = sesProvider({
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret",
    region: "us-east-1",
    configurationSet: "sendr",
    maxSendsPerSecond: 14,
    fetch: async (input) => {
      requests.push(input as Request)
      return response.clone()
    },
  })
  return { provider, requests }
}

const email = {
  from: "Evan <evan@example.com>",
  to: "ann@example.com",
  replyTo: "hello@example.com",
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
  headers: { "List-Unsubscribe": "<https://x/u/t>" },
}

describe("SES provider", () => {
  it("sends a signed SES v2 request with content, headers and configuration set", async () => {
    const { provider, requests } = providerReplying(
      Response.json({ MessageId: "ses-123" })
    )
    expect(await provider.send(email)).toEqual({ providerMessageId: "ses-123" })

    const [sent] = requests
    expect(sent.url).toBe("https://email.us-east-1.amazonaws.com/v2/email/outbound-emails")
    expect(sent.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
    expect(await sent.json()).toEqual({
      FromEmailAddress: "Evan <evan@example.com>",
      Destination: { ToAddresses: ["ann@example.com"] },
      ReplyToAddresses: ["hello@example.com"],
      ConfigurationSetName: "sendr",
      Content: {
        Simple: {
          Subject: { Data: "Hello", Charset: "UTF-8" },
          Body: {
            Html: { Data: "<p>Hi</p>", Charset: "UTF-8" },
            Text: { Data: "Hi", Charset: "UTF-8" },
          },
          Headers: [{ Name: "List-Unsubscribe", Value: "<https://x/u/t>" }],
        },
      },
    })
  })

  it("a rejected message fails permanently", async () => {
    const { provider } = providerReplying(
      new Response('{"message":"Email address is not verified."}', {
        status: 400,
        headers: { "x-amzn-ErrorType": "MessageRejected:http://internal.amazon.com/" },
      })
    )
    await expect(provider.send(email)).rejects.toBeInstanceOf(PermanentSendError)
  })

  it("throttling is retried rather than failing the email", async () => {
    const { provider } = providerReplying(
      new Response("{}", {
        status: 429,
        headers: { "x-amzn-ErrorType": "TooManyRequestsException" },
      })
    )
    const error = await provider.send(email).catch((caught) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(PermanentSendError)
  })
})

describe("SES events from EventBridge", () => {
  it("maps deliveries, permanent bounces and complaints, and ignores the rest", () => {
    const event = (detail: object) => ({ source: "aws.ses", detail })
    expect(
      parseSesEvents([
        event({ eventType: "Delivery", mail: { messageId: "a" } }),
        event({ eventType: "Bounce", mail: { messageId: "b" }, bounce: { bounceType: "Permanent" } }),
        event({ eventType: "Bounce", mail: { messageId: "c" }, bounce: { bounceType: "Transient" } }),
        event({ eventType: "Complaint", mail: { messageId: "d" } }),
        event({ eventType: "Open", mail: { messageId: "e" } }),
      ])
    ).toEqual([
      { type: "delivered", providerMessageId: "a" },
      { type: "bounced", providerMessageId: "b" },
      { type: "complained", providerMessageId: "d" },
    ])
  })

  it("accepts a bare event detail", () => {
    expect(parseSesEvents({ eventType: "Delivery", mail: { messageId: "a" } })).toEqual([
      { type: "delivered", providerMessageId: "a" },
    ])
  })
})
