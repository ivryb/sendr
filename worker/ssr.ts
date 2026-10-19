import { AsyncLocalStorage } from "node:async_hooks"
import { env } from "cloudflare:workers"
import type { Hono } from "hono"

import { renderPage } from "../src/entry-server"
import type { SsrContext } from "../src/lib/ssr"

const requestContext = new AsyncLocalStorage<SsrContext>()
globalThis.__sendrSsr = () => requestContext.getStore()

/**
 * Server-renders an admin page. The app's API calls run in-process against `app` with the
 * visitor's cookies, at the request's own origin so Better Auth reads the same session cookie.
 */
export async function serverRender(request: Request, app: Hono<{ Bindings: Env }>) {
  const url = new URL(request.url)
  const template = await (await env.ASSETS.fetch(new URL("/", url))).text()
  const cookie = request.headers.get("cookie") ?? ""
  const timeZone = decodeURIComponent(cookie.match(/(?:^|;\s*)tz=([^;]+)/)?.[1] ?? "UTC")

  const fetchInProcess: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    if (cookie) headers.set("cookie", cookie)
    return app.request(new URL(String(input), url), { ...init, headers }, env)
  }
  return requestContext.run({ fetch: fetchInProcess, timeZone: safeTimeZone(timeZone) }, () =>
    renderPage(request, template)
  )
}

function safeTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return timeZone
  } catch {
    return "UTC"
  }
}
