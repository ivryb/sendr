import { z } from "zod"

import { LOGIN_CODE_PATTERN, loginCodeEmail } from "../shared/login-code"
import llms from "./llms.txt"

const LoginCode = z.object({
  email: z.email(),
  code: z.string().regex(LOGIN_CODE_PATTERN),
})

/**
 * Delivers login codes for Sendr instances that can't send email yet, so a fresh deploy's
 * first sign-in works. The email is fixed apart from the code, so the endpoint is useless
 * for spam beyond what the rate limits allow.
 */
async function sendLoginCode(request: Request, env: Env) {
  const body = LoginCode.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: "invalid_request" }, { status: 400 })

  const email = body.data.email.toLowerCase()
  const allowed =
    (await env.PER_RECIPIENT.limit({ key: email })).success &&
    (await env.OVERALL.limit({ key: "all" })).success
  if (!allowed) return Response.json({ error: "rate_limited" }, { status: 429 })

  await env.EMAIL.send({
    from: { email: "hello@sendr.soy", name: "Sendr" },
    to: email,
    ...loginCodeEmail(body.data.code),
  })
  return new Response(null, { status: 204 })
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
