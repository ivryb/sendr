import { passkey } from "@better-auth/passkey"
import { env, waitUntil } from "cloudflare:workers"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { emailOTP } from "better-auth/plugins"
import { desc, eq, sql } from "drizzle-orm"

import { db } from "./db/client"
import * as schema from "./db/schema"
import type { SenderRow } from "./db/schema"
import { defaultSender } from "./domain/senders"
import { memoryProvider, senderProvider } from "./email/providers"
import { loginCodeEmail } from "../shared/login-code"
import { getSettings, updateSettings, type InstanceSettings } from "./lib/settings"

/** Auth is built per request: its secret lives in D1 and passkeys bind to the request's host. */
export function createAuth(settings: InstanceSettings, requestUrl: string) {
  const origin = new URL(requestUrl).origin
  return betterAuth({
    baseURL: origin,
    basePath: "/api/auth",
    secret: settings.secret,
    database: drizzleAdapter(db(), { provider: "sqlite", schema }),
    emailAndPassword: { enabled: false },
    // Sign-in is the only use for a code, and the only endpoint that spends a guess atomically.
    // check-verification-otp reads, compares and counts in separate steps, so guesses sent
    // together all go uncounted, and it confirms the right code without using it up. The
    // password and email-change ones would take guesses and send codes past the hourly cap.
    disabledPaths: [
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/reset-password",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
    ],
    plugins: [
      passkey({ rpID: new URL(origin).hostname, rpName: "Sendr", origin }),
      emailOTP({
        sendVerificationOTP: async ({ email, otp, type }) => {
          // Only sign-in codes are of use here. Password reset requests would otherwise email
          // codes past the cap on sign-in codes.
          if (type !== "sign-in") return
          // Both lookups run for every address, so response timing doesn't reveal admins.
          const [allowed, sender] = await Promise.all([canSignIn(email), defaultSender()])
          if (allowed) waitUntil(sendLoginCode(sender, email, otp))
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/email-otp/send-verification-otp") await countLoginCode(ctx.body?.email)
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Admins are created only by signing in with ADMIN_EMAIL, the address the deployer chose.
          before: async (user) => {
            if (!isAdminEmail(user.email)) throw new APIError("FORBIDDEN")
          },
          // Unsubscribe links need the instance's address; the first sign-in fills it in.
          after: async () => {
            if (!settings.publicUrl) await updateSettings({ publicUrl: origin })
          },
        },
      },
    },
  })
}

export type Admin = { id: string; email: string; name: string }

/** The admin signed in on `request`, or null. */
export async function getAdmin(request: Request): Promise<Admin | null> {
  const auth = createAuth(await getSettings(), request.url)
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null
  const { id, email, name } = session.user
  return { id, email, name }
}

export async function isClaimed() {
  return Boolean(
    await db().query.user.findFirst({ columns: { id: true } })
  )
}

function isAdminEmail(email: string) {
  // Instances deployed before ADMIN_EMAIL existed don't have it; their admins still sign in.
  const adminEmail = (env.ADMIN_EMAIL ?? "").trim().toLowerCase()
  return adminEmail !== "" && email.toLowerCase() === adminEmail
}

/** The admin's passkeys, newest first, for listing in Settings. */
export function listPasskeys(userId: string) {
  return db().query.passkey.findMany({
    columns: { id: true, name: true, createdAt: true },
    where: eq(schema.passkey.userId, userId),
    orderBy: desc(schema.passkey.createdAt),
  })
}

const LOGIN_CODES_PER_HOUR = 5
const HOUR = 60 * 60 * 1000

/**
 * Counts a code request for `email` and refuses it past the hourly cap, before Better Auth
 * stores a new code. Each code allows 3 guesses and a new code resets them, so this cap is what
 * bounds guessing. Better Auth's own limiter is off on Workers (no NODE_ENV) and keeps its
 * counts in one isolate's memory; D1 counts across all of them.
 */
async function countLoginCode(email: unknown) {
  // Better Auth refuses a request without an email itself.
  if (typeof email !== "string") return
  const now = Date.now()
  const { count, windowStart } = schema.loginCodeRequests
  const expired = sql`${windowStart} <= ${now - HOUR}`
  const database = db()
  const [[row]] = await database.batch([
    database
      .insert(schema.loginCodeRequests)
      .values({ email: email.trim().toLowerCase(), windowStart: new Date(now), count: 1 })
      .onConflictDoUpdate({
        target: schema.loginCodeRequests.email,
        set: {
          count: sql`case when ${expired} then 1 else ${count} + 1 end`,
          windowStart: sql`case when ${expired} then ${now} else ${windowStart} end`,
        },
      })
      .returning(),
    // Every address asked for gets a row, so rows whose hour is over go, after the upsert has
    // restarted this one's. The table then holds only the last hour's addresses.
    database.delete(schema.loginCodeRequests).where(expired),
  ])
  if (row.count <= LOGIN_CODES_PER_HOUR) return
  const minutes = Math.ceil((row.windowStart.getTime() + HOUR - now) / 60_000)
  throw new APIError("TOO_MANY_REQUESTS", {
    message: `Too many codes for this email. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
  })
}

/** Codes go to existing admins and to ADMIN_EMAIL, which becomes an admin on first sign-in. */
async function canSignIn(email: string) {
  if (isAdminEmail(email)) return true
  const user = await db().query.user.findFirst({
    columns: { id: true },
    where: eq(schema.user.email, email.toLowerCase()),
  })
  return Boolean(user)
}

/**
 * Sends from the instance's own sender once one is verified. Before that, or when that send
 * fails (SES still in its sandbox, say), sendr.soy delivers the code so a new instance's admin
 * is never locked out.
 */
async function sendLoginCode(sender: SenderRow | null, email: string, otp: string) {
  const message = { to: [email], ...loginCodeEmail(otp) }
  const relay = env.LOGIN_CODE_RELAY_URL
  if (sender?.verified) {
    try {
      return void (await senderProvider(sender).send(message))
    } catch (error) {
      if (!relay) throw error
      console.warn("Login code send failed, delivering it through sendr.soy instead", error)
    }
  }
  if (!relay) {
    // Local development: no sender yet, and the dev log shows the code.
    const memory = memoryProvider()
    if (!memory) throw new Error("No verified sender and no LOGIN_CODE_RELAY_URL to send login codes.")
    return void (await memory.send({ from: "Sendr <login@localhost>", ...message }))
  }
  const response = await fetch(relay, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code: otp }),
  })
  if (!response.ok) throw new Error(`sendr.soy refused the login code: ${response.status}`)
}
