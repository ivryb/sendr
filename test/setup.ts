import { applyD1Migrations, env, reset } from "cloudflare:test"
import { beforeEach } from "vitest"

import { memoryOutbox } from "../worker/email/providers"

// Every test starts from a fresh, unclaimed instance.
beforeEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  memoryOutbox.length = 0
})
