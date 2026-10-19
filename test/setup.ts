import { applyD1Migrations, env, reset } from "cloudflare:test"
import { beforeEach, vi } from "vitest"

import { memoryOutbox } from "../worker/email/providers"
import { relayedCodes } from "./helpers"

// Login codes for an instance without a sender go to sendr.soy; record them instead.
const realFetch = globalThis.fetch
vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
  if (String(input) !== env.LOGIN_CODE_RELAY_URL) return realFetch(input, init)
  relayedCodes.push(JSON.parse(String(init?.body)))
  return Promise.resolve(new Response(null, { status: 204 }))
})

// Every test starts from a fresh, unclaimed instance.
beforeEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  memoryOutbox.length = 0
  relayedCodes.length = 0
})
