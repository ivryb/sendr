import { DomainError } from "./errors"

// D1's messages once Workers Free's daily rows are used up; every query fails until 00:00 UTC.
// https://developers.cloudflare.com/d1/observability/debug-d1/
const DAILY_LIMITS = [
  { pattern: /daily row read limit/, limit: "5 million database rows read a day" },
  { pattern: /daily row write limit/, limit: "100,000 database rows written a day" },
]

// The runtime's message past 50 subrequests in one invocation, and D1's past 50 queries, which
// its docs spell "by single Worker invocation".
const INVOCATION_LIMIT = /Too many subrequests|Too many API requests by single worker invocation/i

/** Cloudflare refused the work because the account hit a Workers Free limit. */
export class LimitError extends DomainError {
  /** Lifts at 00:00 UTC, rather than with the next request. */
  readonly daily: boolean
  constructor(message: string, daily: boolean) {
    super("cloudflare_limit", 503, message)
    this.daily = daily
  }
}

/** The Workers Free limit behind `error`, which may be wrapped (Drizzle keeps D1's as its cause). */
export function limitError(error: unknown): LimitError | null {
  const text = messages(error).join("\n")
  const daily = DAILY_LIMITS.find(({ pattern }) => pattern.test(text))
  if (daily) {
    const hours = Math.floor(secondsUntilReset() / 3600)
    const when = hours < 1 ? "under an hour" : `about ${hours} hour${hours === 1 ? "" : "s"}`
    return new LimitError(
      `This Sendr used up Cloudflare's Workers Free limit of ${daily.limit}. It resets at 00:00 UTC, in ${when}. Campaigns that are sending pause until then and pick up on their own. Workers Paid ($5 a month) lifts the limit.`,
      true
    )
  }
  if (INVOCATION_LIMIT.test(text)) {
    return new LimitError(
      "This request needed more than the 50 database queries and outside requests Workers Free allows in one request. Try a smaller batch, or move to Workers Paid ($5 a month).",
      false
    )
  }
  return null
}

/** Seconds until Workers Free's daily limits reset, at the next 00:00 UTC. */
export function secondsUntilReset(now = new Date()) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.ceil((midnight - now.getTime()) / 1000)
}

function messages(error: unknown): string[] {
  if (!(error instanceof Error)) return []
  return [error.message, ...messages(error.cause)]
}
