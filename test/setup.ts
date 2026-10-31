import { applyD1Migrations, env, reset } from "cloudflare:test"
import { beforeEach, vi } from "vitest"

import { memoryOutbox } from "../worker/email/providers"
import { fakeAwsResponse, resetFakeAws } from "./fake-aws"
import { fakeDnsResponse, resetFakeDns } from "./fake-dns"
import { relayedCodes } from "./helpers"

const realFetch = globalThis.fetch
vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
  const request = new Request(input, init)
  // Login codes for an instance without a sender go to sendr.soy; record them instead.
  if (request.url === env.LOGIN_CODE_RELAY_URL) {
    relayedCodes.push(JSON.parse(String(init?.body)))
    return Promise.resolve(new Response(null, { status: 204 }))
  }
  const { hostname } = new URL(request.url)
  if (hostname.endsWith(".amazonaws.com")) return fakeAwsResponse(request)
  if (hostname === "cloudflare-dns.com") return Promise.resolve(fakeDnsResponse(request))
  return realFetch(input, init)
})

// Every test starts from a fresh, unclaimed instance.
beforeEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  memoryOutbox.length = 0
  relayedCodes.length = 0
  resetFakeAws()
  resetFakeDns()
})
