import { z } from "zod"

import { LOGIN_CODE_PATTERN, loginCodeEmail } from "../shared/login-code"
import llms from "./llms.txt"

const LoginCode = z.object({
  email: z.email(),
  code: z.string().regex(LOGIN_CODE_PATTERN),
})

// A new instance's admin needs a code or two; an inbox flooded by `hello@sendr.soy` gets the
// address flagged and Cloudflare's sending suspended. Each send writes two KV keys, so the
// overall cap also keeps KV within the Free plan's 1,000 writes a day.
const DAILY_PER_INBOX = 10
const DAILY_OVERALL = 200

/**
 * Delivers login codes for Sendr instances that can't send email yet, so a fresh deploy's
 * first sign-in works. The email is fixed apart from the code, so the endpoint is useless
 * for spam beyond what the limits allow.
 */
async function sendLoginCode(request: Request, env: Env) {
  const body = LoginCode.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: "invalid_request" }, { status: 400 })

  const email = body.data.email.toLowerCase()
  const key = inbox(email)
  const allowed =
    (await env.PER_RECIPIENT.limit({ key })).success &&
    (await env.OVERALL.limit({ key: "all" })).success &&
    (await countDailySend(env, key))
  if (!allowed) return Response.json({ error: "rate_limited" }, { status: 429 })

  await env.EMAIL.send({
    from: { email: "hello@sendr.soy", name: "Sendr" },
    to: email,
    ...loginCodeEmail(body.data.code),
  })
  return new Response(null, { status: 204 })
}

/**
 * The inbox an address delivers to, so its spellings share one count: "+tag" is dropped for
 * every domain, and Gmail also ignores dots and answers at googlemail.com.
 */
function inbox(email: string) {
  const at = email.lastIndexOf("@")
  const name = email.slice(0, at).split("+")[0]
  const domain = email.slice(at + 1)
  if (domain !== "gmail.com" && domain !== "googlemail.com") return `${name}@${domain}`
  return `${name.replaceAll(".", "")}@gmail.com`
}

/**
 * Counts a send against today's caps, or refuses it once either is reached. Rate limits only
 * count per Cloudflare location, so these counts live in KV. KV can lag by a minute between
 * locations, which lets a few extra through at most.
 */
async function countDailySend(env: Env, inbox: string) {
  const day = new Date().toISOString().slice(0, 10)
  const caps = [
    { key: `${day}:${inbox}`, cap: DAILY_PER_INBOX },
    { key: `${day}:all`, cap: DAILY_OVERALL },
  ]
  const counts = await Promise.all(caps.map(({ key }) => env.SENT_TODAY.get(key).then(Number)))
  if (caps.some(({ cap }, i) => counts[i] >= cap)) return false
  await Promise.all(
    caps.map(({ key }, i) =>
      env.SENT_TODAY.put(key, String(counts[i] + 1), { expirationTtl: 2 * 24 * 60 * 60 })
    )
  )
  return true
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname === "/api/login-code" && request.method === "POST") {
      return sendLoginCode(request, env)
    }
    // The setup guide people paste into their agent.
    if (pathname === "/llms.txt") {
      return new Response(llms, { headers: { "content-type": "text/plain; charset=utf-8" } })
    }
    return Response.redirect("https://github.com/ivryb/sendr", 302)
  },
} satisfies ExportedHandler<Env>
