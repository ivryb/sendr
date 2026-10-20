import { passkey } from "@better-auth/passkey"
import { env, waitUntil } from "cloudflare:workers"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"
import { emailOTP } from "better-auth/plugins"
import { desc, eq } from "drizzle-orm"

import { db } from "./db/client"
import * as schema from "./db/schema"
import { emailProvider } from "./email/providers"
import { loginCodeEmail } from "../shared/login-code"
import { senderAddress } from "../shared/model"
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
    plugins: [
      passkey({ rpID: new URL(origin).hostname, rpName: "Sendr", origin }),
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          if (await canSignIn(email)) waitUntil(sendLoginCode(settings, email, otp))
        },
      }),
    ],
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

export type Auth = ReturnType<typeof createAuth>

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
 * Sends from the instance's own sender once it has one. Before that, or when that send fails
 * (SES not set up yet, or still in its sandbox), sendr.soy delivers the code so a new
 * instance's admin is never locked out.
 */
async function sendLoginCode(settings: InstanceSettings, email: string, otp: string) {
  const sendOwn = () =>
    emailProvider(env.AUTH_EMAIL_PROVIDER).send({
      from: senderAddress(settings),
      to: email,
      ...loginCodeEmail(otp),
    })
  const relay = env.LOGIN_CODE_RELAY_URL
  if (!relay) return void (await sendOwn())
  if (settings.fromEmail) {
    try {
      return void (await sendOwn())
    } catch (error) {
      console.warn("Login code send failed, delivering it through sendr.soy instead", error)
    }
  }
  const response = await fetch(relay, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code: otp }),
  })
  if (!response.ok) throw new Error(`sendr.soy refused the login code: ${response.status}`)
}
