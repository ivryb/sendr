/** Stands in for SES and SNS: test/setup.ts routes requests to amazonaws.com here. */
export const fakeAws = {
  /** The domain passes verification and the account is out of the sandbox. */
  verified: true,
  production: true,
  /** AWS rejects the key outright. */
  rejectKey: false,
  /** AWS confirmed the SNS subscription, from an earlier sender or an earlier setup. */
  subscriptionConfirmed: false,
  /** The key was made with the policy from before Sendr read subscription attributes. */
  denySubscriptionAttributes: false,
  /** The account's 24-hour sending quota, and how much of it the last 24 hours used. */
  max24HourSend: 50000,
  sentLast24Hours: 0,
  requests: [] as { method: string; url: string; body: string }[],
}

export const TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:sendr-events"

export function resetFakeAws() {
  Object.assign(fakeAws, {
    verified: true,
    production: true,
    rejectKey: false,
    subscriptionConfirmed: false,
    denySubscriptionAttributes: false,
    max24HourSend: 50000,
    sentLast24Hours: 0,
    requests: [],
  })
}

export async function fakeAwsResponse(request: Request) {
  const url = new URL(request.url)
  const body = await request.text()
  fakeAws.requests.push({ method: request.method, url: request.url, body })
  if (fakeAws.rejectKey) {
    return Response.json(
      { message: "The security token included in the request is invalid." },
      { status: 403, headers: { "x-amzn-ErrorType": "UnrecognizedClientException" } }
    )
  }
  if (url.hostname.startsWith("sns.")) {
    const params = new URLSearchParams(body)
    const action = params.get("Action") ?? url.searchParams.get("Action")
    if (action === "GetSubscriptionAttributes" && fakeAws.denySubscriptionAttributes) {
      return new Response("<ErrorResponse><Error><Code>AuthorizationError</Code></Error></ErrorResponse>", { status: 403 })
    }
    const pending = String(!fakeAws.subscriptionConfirmed)
    const result =
      action === "CreateTopic"
        ? `<TopicArn>${TOPIC_ARN}</TopicArn>`
        : action === "Subscribe"
          ? // As AWS does for https, even once the subscription is confirmed.
            `<SubscriptionArn>${params.get("ReturnSubscriptionArn") === "true" ? `${TOPIC_ARN}:sub-1` : "pending confirmation"}</SubscriptionArn>`
          : action === "GetSubscriptionAttributes"
            ? `<Attributes><entry><key>PendingConfirmation</key><value>${pending}</value></entry></Attributes>`
            : ""
    return new Response(`<${action}Response><${action}Result>${result}</${action}Result></${action}Response>`)
  }
  const path = url.pathname.replace("/v2/email", "")
  if (path === "/account") {
    return Response.json({
      ProductionAccessEnabled: fakeAws.production,
      SendQuota: {
        MaxSendRate: 14,
        Max24HourSend: fakeAws.max24HourSend,
        SentLast24Hours: fakeAws.sentLast24Hours,
      },
    })
  }
  if (request.method === "GET" && path.startsWith("/identities/")) {
    const status = fakeAws.verified ? "SUCCESS" : "PENDING"
    return Response.json({
      VerifiedForSendingStatus: fakeAws.verified,
      DkimAttributes: { Tokens: ["tok1", "tok2", "tok3"], Status: status },
      MailFromAttributes: {
        MailFromDomain: `bounce.${path.split("/")[2]}`,
        MailFromDomainStatus: status,
      },
    })
  }
  return Response.json({})
}
