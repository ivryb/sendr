import { describe, expect, it } from "vitest"

import { PermanentSendError } from "../worker/email/provider"
import { parseSesEvent, sesProvider } from "../worker/email/ses"

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
  to: ["ann@example.com"],
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
    expect(sent.url).toBe(
      "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails"
    )
    expect(sent.headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//
    )
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

  it("leaves out the text part of an HTML-only email", async () => {
    const { provider, requests } = providerReplying(
      Response.json({ MessageId: "ses-1" })
    )
    await provider.send({ ...email, text: "" })
    const body = await requests[0].json<{
      Content: { Simple: { Body: object } }
    }>()
    expect(body.Content.Simple.Body).toEqual({
      Html: { Data: "<p>Hi</p>", Charset: "UTF-8" },
    })
  })

  it("sends a text-only email without an HTML part", async () => {
    const { provider, requests } = providerReplying(Response.json({ MessageId: "ses-2" }))
    await provider.send({ ...email, html: null })
    const body = await requests[0].json<{ Content: { Simple: { Body: object } } }>()
    expect(body.Content.Simple.Body).toEqual({ Text: { Data: "Hi", Charset: "UTF-8" } })
  })

  it("sends one message to several recipients and copies", async () => {
    const { provider, requests } = providerReplying(Response.json({ MessageId: "ses-3" }))
    await provider.send({ ...email, to: ["ann@example.com", "bob@example.com"], cc: ["ops@example.com"] })
    const body = await requests[0].json<{ Destination: object }>()
    expect(body.Destination).toEqual({
      ToAddresses: ["ann@example.com", "bob@example.com"],
      CcAddresses: ["ops@example.com"],
    })
  })

  it("a rejected message fails permanently", async () => {
    const { provider } = providerReplying(
      new Response('{"message":"Email address is not verified."}', {
        status: 400,
        headers: {
          "x-amzn-ErrorType": "MessageRejected:http://internal.amazon.com/",
        },
      })
    )
    await expect(provider.send(email)).rejects.toBeInstanceOf(
      PermanentSendError
    )
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

describe("SES events", () => {
  it("maps deliveries, permanent bounces and complaints, with who they're about, and ignores the rest", () => {
    const ann = { emailAddress: "Ann@example.com" }
    const events = [
      { eventType: "Delivery", mail: { messageId: "a" }, delivery: { recipients: ["ann@example.com"] } },
      {
        eventType: "Bounce",
        mail: { messageId: "b" },
        bounce: { bounceType: "Permanent", bouncedRecipients: [ann] },
      },
      {
        eventType: "Bounce",
        mail: { messageId: "c" },
        bounce: { bounceType: "Transient", bouncedRecipients: [ann] },
      },
      { eventType: "Complaint", mail: { messageId: "d" }, complaint: { complainedRecipients: [ann] } },
      { eventType: "Open", mail: { messageId: "e" } },
    ]
    const recipients = ["ann@example.com"]
    expect(events.map((event) => parseSesEvent(JSON.stringify(event)))).toEqual([
      { type: "delivered", providerMessageId: "a", recipients },
      { type: "bounced", providerMessageId: "b", recipients },
      null,
      { type: "complained", providerMessageId: "d", recipients },
      null,
    ])
  })
})
