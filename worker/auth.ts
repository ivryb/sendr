import { passkey } from "@better-auth/passkey"
import { env, waitUntil } from "cloudflare:workers"
import { betterAuth, type BetterAuthPlugin } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { emailOTP } from "better-auth/plugins"
import { z } from "zod"

import { db } from "./db/client"
import * as schema from "./db/schema"
import { emailProvider } from "./email/providers"
import { sha256, timingSafeEqual } from "./lib/crypto"
import {
  getSettings,
  senderAddress,
  updateSettings,
  type InstanceSettings,
} from "./lib/settings"

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
        disableSignUp: true,
        sendVerificationOTP: async ({ email, otp }) => {
          waitUntil(sendLoginCode(settings, email, otp))
        },
      }),
      setupClaim(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

/**
 * The first visitor who knows SETUP_CODE becomes an admin. A code works once; setting a new
 * SETUP_CODE in the Cloudflare dashboard lets the account owner recover access.
 */
function setupClaim() {
  return {
    id: "setup-claim",
    endpoints: {
      claimInstance: createAuthEndpoint(
        "/setup/claim",
        {
          method: "POST",
          body: z.object({
            setupCode: z.string().min(1),
            email: z.email(),
            name: z.string().trim().min(1),
          }),
        },
        async (ctx) => {
          const { setupCode, name } = ctx.body
          const email = ctx.body.email.toLowerCase()
          if (!env.SETUP_CODE || !timingSafeEqual(setupCode, env.SETUP_CODE)) {
            throw new APIError("FORBIDDEN", { message: "Wrong setup code" })
          }
          const settings = await getSettings()
          const codeHash = await sha256(setupCode)
          if (settings.claimedSetupCodeHash === codeHash) {
            throw new APIError("FORBIDDEN", {
              message:
                "This setup code was already used. Set a new SETUP_CODE to recover access.",
            })
          }

          const internal = ctx.context.internalAdapter
          const user =
            (await internal.findUserByEmail(email))?.user ??
            (await internal.createUser(
              { email, name, emailVerified: true },
              { method: "setup-code" }
            ))
          const session = await internal.createSession(user.id)
          await setSessionCookie(ctx, { session, user })
          await updateSettings({
            claimedSetupCodeHash: codeHash,
            publicUrl: settings.publicUrl || new URL(ctx.request!.url).origin,
          })
          return ctx.json({ user: { id: user.id, email: user.email } })
        }
      ),
    },
  } satisfies BetterAuthPlugin
}

export async function isClaimed() {
  return Boolean(
    await db().query.user.findFirst({ columns: { id: true } })
  )
}

async function sendLoginCode(
  settings: InstanceSettings,
  email: string,
  otp: string
) {
  await emailProvider(env.AUTH_EMAIL_PROVIDER).send({
    from: senderAddress(settings),
    to: email,
    subject: `Your Sendr login code: ${otp}`,
    text: `Your Sendr login code is ${otp}. It expires in 5 minutes.`,
    html: `<p>Your Sendr login code is <strong style="font-size:20px;letter-spacing:2px;">${otp}</strong>.</p><p>It expires in 5 minutes. If you didn't try to sign in, ignore this email.</p>`,
  })
}
