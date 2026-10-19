import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { html } from "hono/html"

import { db } from "../db/client"
import { contacts } from "../db/schema"
import { setContactStatus } from "../domain/contacts"
import { UNSUBSCRIBE_PURPOSE } from "../domain/sending"
import { verifyToken } from "../lib/crypto"
import { getSettings } from "../lib/settings"

/**
 * Recipient-facing unsubscribe pages. A plain visit only asks for confirmation, because mail
 * scanners open links; the POST handles both the button and RFC 8058 one-click requests.
 */
export const unsubscribe = new Hono()
  .get("/:token", async (c) => {
    const found = await findRecipient(c.req.param("token"))
    if (!found) return c.html(invalidLinkPage(c.req.param("token")), 404)
    const { contact, sender } = found
    if (contact.status === "unsubscribed") return c.html(unsubscribedPage(sender, c.req.param("token")))
    if (contact.status !== "subscribed") return c.html(page(sender, "You won't receive more emails", ""))
    return c.html(
      page(
        sender,
        "Unsubscribe?",
        html`<p>You'll stop receiving emails from ${sender} at ${contact.email}.</p>
          <form method="post"><button>Unsubscribe</button></form>`
      )
    )
  })
  .post("/:token", async (c) => {
    const found = await findRecipient(c.req.param("token"))
    if (!found) return c.html(invalidLinkPage(c.req.param("token")), 404)
    await setContactStatus(found.contact.id, "unsubscribed", "subscribed")
    return c.html(unsubscribedPage(found.sender, c.req.param("token")))
  })
  .post("/:token/resubscribe", async (c) => {
    const found = await findRecipient(c.req.param("token"))
    if (!found) return c.html(invalidLinkPage(c.req.param("token")), 404)
    await setContactStatus(found.contact.id, "subscribed", "unsubscribed")
    return c.html(page(found.sender, "You're subscribed again", html`<p>Welcome back.</p>`))
  })

async function findRecipient(token: string) {
  const settings = await getSettings()
  const contactId = await verifyToken(settings.secret, UNSUBSCRIBE_PURPOSE, token)
  if (!contactId) return null
  const contact = await db().query.contacts.findFirst({ where: eq(contacts.id, contactId) })
  return contact ? { contact, sender: settings.fromName || "this sender" } : null
}

function unsubscribedPage(sender: string, token: string) {
  return page(
    sender,
    "You're unsubscribed",
    html`<p>You won't receive more emails from ${sender}.</p>
      <form method="post" action="/u/${token}/resubscribe">
        <button class="secondary">Resubscribe</button>
      </form>`
  )
}

function invalidLinkPage(token: string) {
  // Test sends use a placeholder link, so a curious admin gets a clear answer.
  return token === "test"
    ? page("", "This is a test email", html`<p>Unsubscribe links work in real campaign emails.</p>`)
    : page("", "This link isn't valid", html`<p>It may be incomplete. Try the link from the email again.</p>`)
}

function page(sender: string, title: string, body: unknown) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}${sender ? ` · ${sender}` : ""}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fafaf9; color: #1c1917;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 380px; margin: 24px; padding: 32px; background: #fff; border: 1px solid #e7e5e4; border-radius: 16px; }
  h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.3; }
  p { margin: 0 0 20px; color: #57534e; }
  button { font: inherit; font-weight: 500; padding: 10px 18px; border-radius: 10px; border: 0; background: #1c1917; color: #fafaf9; cursor: pointer; }
  button.secondary { background: #f5f5f4; color: #1c1917; }
  @media (prefers-color-scheme: dark) {
    body { background: #0c0a09; color: #fafaf9; }
    main { background: #1c1917; border-color: #292524; }
    p { color: #a8a29e; }
    button { background: #fafaf9; color: #1c1917; }
    button.secondary { background: #292524; color: #fafaf9; }
  }
</style>
</head>
<body><main><h1>${title}</h1>${body}</main></body>
</html>`
}
