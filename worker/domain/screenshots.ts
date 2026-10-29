import puppeteer from "@cloudflare/puppeteer"
import { env } from "cloudflare:workers"
import { html, raw } from "hono/html"
import { z } from "zod"

import { FONT, PALETTE, renderEmail, sampleRecipient, withScheme } from "../../shared/render"
import { DomainError } from "../lib/errors"
import { getSettings } from "../lib/settings"
import { findCampaign } from "./campaigns"
import { campaignSender, defaultSender } from "./senders"
import { unsubscribeUrl } from "./sending"

const THEMES = ["light", "dark"] as const
type Theme = (typeof THEMES)[number]

export const screenshotQuery = z.object({ theme: z.enum([...THEMES, "both"]).default("both") })

// Email layouts are made for 600px; the panes sit side by side in a padded page.
const PANE_WIDTH = 600
const GAP = 24

// A mail client's header above each pane, in the admin app's stone colors.
const CHROME = {
  light: { bg: "#fafaf9", text: "#1c1917", muted: "#78716c", border: "#e7e5e4" },
  dark: { bg: "#292524", text: "#f5f5f4", muted: "#a8a29e", border: "#44403c" },
}

type Header = { from: { name: string; email: string } | null; subject: string }

/**
 * The campaign as a recipient sees it, as a PNG an agent can show before sending: light, dark,
 * or both side by side, each under a header with the sender and subject. The sample recipient
 * has no contact data, so merge tags show their fallbacks.
 */
export async function screenshotCampaign(id: string, theme: z.infer<typeof screenshotQuery>["theme"]) {
  const campaign = await findCampaign(id)
  const [settings, sender] = await Promise.all([getSettings(), campaignSender(campaign)])
  const from = sender ?? (await defaultSender())
  const email = renderEmail(campaign, settings.footer)({
    recipient: sampleRecipient(),
    unsubscribeUrl: await unsubscribeUrl(settings),
  })
  const header = { from, subject: email.subject }
  const content = email.html ?? (await textDocument(email.text)).toString()
  const themes = theme === "both" ? THEMES : [theme]
  const document = await page(themes.map((each) => pane(each, header, content)))
  return shoot(document.toString(), themes.length * (PANE_WIDTH + GAP) + GAP)
}

async function shoot(content: string, width: number) {
  const browser = await puppeteer.launch(env.BROWSER).catch((error: Error) => {
    console.error(error)
    throw new DomainError(
      "browser_unavailable",
      503,
      `Browser Run couldn't start a browser (${error.message}). It may be at its limit: the Workers Free plan allows a new browser every 20 seconds and 10 browser-minutes a day. Try again in a minute.`
    )
  })
  try {
    const tab = await browser.newPage()
    await tab.setViewport({ width, height: 400, deviceScaleFactor: 2 })
    // The campaign can point at any server; a slow one mustn't hold the browser for puppeteer's
    // default 30 seconds of the 10 free browser-minutes a day.
    await tab.setContent(content, { waitUntil: "load", timeout: 10_000 })
    return new Uint8Array(await tab.screenshot({ type: "png", fullPage: true }))
  } finally {
    await browser.close()
  }
}

function page(panes: ReturnType<typeof pane>[]) {
  return html`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
body { margin: 0; padding: ${GAP}px; display: flex; gap: ${GAP}px; align-items: flex-start; background: #e7e5e4; font: 13px/1.4 ${raw(FONT)}; }
section { width: ${PANE_WIDTH}px; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); }
header { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 12px; padding: 12px 16px; }
header b { font-weight: 500; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
header i { font-style: normal; font-size: 12px; padding: 0 8px; border-radius: 999px; }
iframe { display: block; width: 100%; height: 0; border: 0; }
</style>
</head>
<body>${panes}</body>
</html>`
}

/** The iframe takes its content's height once loaded, before the page's load event. */
function pane(theme: Theme, { from, subject }: Header, content: string) {
  const colors = CHROME[theme]
  return html`<section>
<header style="background: ${colors.bg}; color: ${colors.muted}; border-bottom: 1px solid ${colors.border};">
  <span>From</span><b style="color: ${colors.text};">${from ? html`${from.name || from.email} <span style="color: ${colors.muted}; font-weight: 400;">${from.name && from.email}</span>` : "No sender yet"}</b>
  <i style="border: 1px solid ${colors.border};">${theme === "light" ? "Light" : "Dark"}</i>
  <span>Subject</span><b style="color: ${subject ? colors.text : colors.muted};">${subject || "No subject yet"}</b>
</header>
<iframe sandbox="allow-same-origin" style="color-scheme: ${theme};" srcdoc="${withScheme(content, theme)}"
  onload="this.style.height = this.contentDocument.documentElement.scrollHeight + 'px'"></iframe>
</section>`
}

/** A text campaign, pre-wrapped in the email font, light or dark like the HTML layout. */
function textDocument(text: string) {
  return html`<!doctype html>
<meta charset="utf-8">
<style>
:root { color-scheme: light dark; }
body { margin: 0; background: ${PALETTE.light.bg}; color: ${PALETTE.light.text}; }
@media (prefers-color-scheme: dark) { body { background: ${PALETTE.dark.bg}; color: ${PALETTE.dark.text}; } }
pre { margin: 0; padding: 32px 24px; font: 16px/1.6 ${raw(FONT)}; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
<pre>${text}</pre>`
}
