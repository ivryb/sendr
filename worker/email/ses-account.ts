import { AwsClient } from "aws4fetch"

export type AwsCredentials = {
  accessKeyId: string
  secretAccessKey: string
  region: string
}

/** An AWS API refused a call; `code` is AWS's error name, like "AccessDeniedException". */
export class AwsError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export const CONFIGURATION_SET = "sendr"
const EVENTS_TOPIC = "sendr-events"
const EVENT_DESTINATION = "sendr-events"

export type SesAccount = ReturnType<typeof sesAccount>

/** The SES and SNS calls Sendr makes to set up a sender and check on it. */
export function sesAccount(
  { accessKeyId, secretAccessKey, region }: AwsCredentials,
  send: typeof fetch = fetch
) {
  const aws = new AwsClient({ accessKeyId, secretAccessKey, region })

  async function ses<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const request = await aws.sign(`https://email.${region}.amazonaws.com/v2/email${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      aws: { service: "ses" },
    })
    const response = await send(request)
    const text = await response.text()
    if (response.ok) return (text ? JSON.parse(text) : {}) as T
    const code = response.headers.get("x-amzn-errortype")?.split(":")[0] ?? `HTTP ${response.status}`
    throw new AwsError(code, readMessage(text) ?? code)
  }

  /** SNS speaks the older query API, with XML replies. */
  async function sns(params: Record<string, string>) {
    const request = await aws.sign(`https://sns.${region}.amazonaws.com/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, Version: "2010-03-31" }).toString(),
      aws: { service: "sns" },
    })
    const response = await send(request)
    const text = await response.text()
    if (response.ok) return text
    throw new AwsError(xmlValue(text, "Code") ?? `HTTP ${response.status}`, xmlValue(text, "Message") ?? text)
  }

  /**
   * Subscribes `endpoint` to the topic. True once AWS has confirmed it; until then, SNS
   * posts a confirmation request to the endpoint.
   */
  async function subscribe(topicArn: string, endpoint: string) {
    // For an https endpoint, Subscribe answers "pending confirmation" even when AWS confirmed
    // the subscription long ago, so get its ARN and ask whether it still waits.
    const reply = await sns({
      Action: "Subscribe",
      TopicArn: topicArn,
      Protocol: "https",
      Endpoint: endpoint,
      ReturnSubscriptionArn: "true",
    })
    const subscriptionArn = xmlValue(reply, "SubscriptionArn")
    if (!subscriptionArn) return false
    const attributes = await sns({ Action: "GetSubscriptionAttributes", SubscriptionArn: subscriptionArn }).catch(
      (error: unknown) => {
        // Keys made with the policy from before Sendr asked: the confirmation webhook still
        // marks reports as connected.
        if (error instanceof AwsError && error.code === "AuthorizationError") return ""
        throw error
      }
    )
    return /<key>PendingConfirmation<\/key>\s*<value>false<\/value>/.test(attributes)
  }

  /**
   * Has SES itself skip addresses that bounced or complained after an email from the `sendr`
   * configuration set. Sendr's own record of them comes through SNS, which retries a report
   * for an hour at most (AWS's limit), so a report lost while a Workers Free daily limit is out
   * would let the next campaign mail them. SES instead drops that email and reports a bounce,
   * which Sendr records. Only Sendr's sends change: the account's own settings stay.
   */
  async function suppressReported() {
    await ses(`/configuration-sets/${CONFIGURATION_SET}/suppression-options`, "PUT", {
      SuppressedReasons: ["BOUNCE", "COMPLAINT"],
    })
  }

  /** Creating something that already exists is fine: setup can run again for another sender. */
  const allowExisting = (error: unknown) => {
    if (!(error instanceof AwsError && error.code === "AlreadyExistsException")) throw error
  }

  return {
    async account() {
      const account = await ses<{
        ProductionAccessEnabled?: boolean
        SendQuota?: { MaxSendRate?: number; Max24HourSend?: number; SentLast24Hours?: number }
      }>("/account")
      return {
        production: account.ProductionAccessEnabled ?? false,
        maxSendRate: account.SendQuota?.MaxSendRate ?? 1,
        // -1 means no daily quota.
        max24HourSend: account.SendQuota?.Max24HourSend ?? 200,
        sentLast24Hours: account.SendQuota?.SentLast24Hours ?? 0,
      }
    },

    subscribe,
    suppressReported,

    /**
     * Publishes delivery, bounce and complaint events from the `sendr` configuration set to an
     * SNS topic, and subscribes `endpoint` to it.
     */
    async connectEvents(endpoint: string) {
      const topicArn = xmlValue(await sns({ Action: "CreateTopic", Name: EVENTS_TOPIC }), "TopicArn")
      if (!topicArn) throw new AwsError("NoTopicArn", "SNS didn't return the topic it created.")
      const confirmed = await subscribe(topicArn, endpoint)
      await ses("/configuration-sets", "POST", { ConfigurationSetName: CONFIGURATION_SET }).catch(
        allowExisting
      )
      await suppressReported()
      const destination = {
        Enabled: true,
        MatchingEventTypes: ["DELIVERY", "BOUNCE", "COMPLAINT"],
        SnsDestination: { TopicArn: topicArn },
      }
      const destinations = `/configuration-sets/${CONFIGURATION_SET}/event-destinations`
      await ses(destinations, "POST", {
        EventDestinationName: EVENT_DESTINATION,
        EventDestination: destination,
      }).catch(async (error) => {
        allowExisting(error)
        await ses(`${destinations}/${EVENT_DESTINATION}`, "PUT", { EventDestination: destination })
      })
      return { topicArn, confirmed }
    },

    /** Starts verifying `domain` with Easy DKIM and a custom MAIL FROM subdomain for SPF. */
    async addDomain(domain: string) {
      await ses("/identities", "POST", { EmailIdentity: domain }).catch(allowExisting)
      await ses(`/identities/${domain}/mail-from`, "PUT", {
        MailFromDomain: mailFromDomain(domain),
        BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
      })
    },

    async domain(domain: string) {
      const identity = await ses<{
        VerifiedForSendingStatus?: boolean
        DkimAttributes?: { Tokens?: string[]; Status?: string }
        MailFromAttributes?: { MailFromDomain?: string; MailFromDomainStatus?: string }
      }>(`/identities/${domain}`)
      return {
        verified: identity.VerifiedForSendingStatus ?? false,
        dkimTokens: identity.DkimAttributes?.Tokens ?? [],
        dkimVerified: identity.DkimAttributes?.Status === "SUCCESS",
        mailFromDomain: identity.MailFromAttributes?.MailFromDomain ?? mailFromDomain(domain),
        mailFromVerified: identity.MailFromAttributes?.MailFromDomainStatus === "SUCCESS",
      }
    },
  }
}

/**
 * Bounces come back through this subdomain, so SPF passes for the sender's own domain. Not
 * `mail.`, which often already points at a webmail host and can't take an MX record too.
 */
function mailFromDomain(domain: string) {
  return `bounce.${domain}`
}

function readMessage(text: string) {
  try {
    const body = JSON.parse(text) as { message?: string; Message?: string }
    return body.message ?? body.Message
  } catch {
    return undefined
  }
}

function xmlValue(xml: string, tag: string) {
  return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]
}
