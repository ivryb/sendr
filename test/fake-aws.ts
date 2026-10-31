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
  /** SES configuration sets in the account, with their suppression reasons and event destinations. */
  configurationSets: {} as Record<string, ConfigurationSet>,
  requests: [] as { method: string; url: string; body: string }[],
}

type ConfigurationSet = { suppressedReasons?: string[]; destinations: Record<string, unknown> }

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
    configurationSets: {},
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
  if (path.startsWith("/configuration-sets")) return configurationSetResponse(request.method, path, body)
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

/** Answers SES's configuration set calls as AWS does, refusing to create twice or update what's missing. */
function configurationSetResponse(method: string, path: string, body: string) {
  const [, , name, part, destinationName] = path.split("/")
  const input = body ? JSON.parse(body) : {}
  const sets = fakeAws.configurationSets
  const error = (type: string, status: number) =>
    Response.json({ message: type }, { status, headers: { "x-amzn-ErrorType": type } })
  if (!name) {
    if (sets[input.ConfigurationSetName]) return error("AlreadyExistsException", 400)
    sets[input.ConfigurationSetName] = {
      suppressedReasons: input.SuppressionOptions?.SuppressedReasons,
      destinations: {},
    }
    return Response.json({})
  }
  const set = sets[name]
  if (!set) return error("NotFoundException", 404)
  if (part === "suppression-options") {
    set.suppressedReasons = input.SuppressedReasons
  } else if (method === "POST") {
    if (set.destinations[input.EventDestinationName]) return error("AlreadyExistsException", 400)
    set.destinations[input.EventDestinationName] = input.EventDestination
  } else {
    if (!set.destinations[destinationName]) return error("NotFoundException", 404)
    set.destinations[destinationName] = input.EventDestination
  }
  return Response.json({})
}
