/** Stands in for SES and SNS: test/setup.ts routes requests to amazonaws.com here. */
export const fakeAws = {
  /** The domain passes verification and the account is out of the sandbox. */
  verified: true,
  production: true,
  /** AWS rejects the key outright. */
  rejectKey: false,
  requests: [] as { method: string; url: string; body: string }[],
}

export const TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:sendr-events"

export function resetFakeAws() {
  Object.assign(fakeAws, { verified: true, production: true, rejectKey: false, requests: [] })
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
    const action = new URLSearchParams(body).get("Action") ?? url.searchParams.get("Action")
    const result =
      action === "CreateTopic"
        ? `<TopicArn>${TOPIC_ARN}</TopicArn>`
        : action === "Subscribe"
          ? "<SubscriptionArn>pending confirmation</SubscriptionArn>"
          : ""
    return new Response(`<${action}Response><${action}Result>${result}</${action}Result></${action}Response>`)
  }
  const path = url.pathname.replace("/v2/email", "")
  if (path === "/account") {
    return Response.json({
      ProductionAccessEnabled: fakeAws.production,
      SendQuota: { MaxSendRate: 14, Max24HourSend: 50000, SentLast24Hours: 0 },
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
