import { isTag, isText, type ChildNode } from "domhandler"
import { parseDocument } from "htmlparser2"
import { Marked } from "marked"

import type { CampaignFormat } from "./model"

/** Renders a campaign for one recipient. Shared by sending and the admin app's live preview. */
export type RenderInput = {
  subject: string
  format: CampaignFormat
  body: string
  footer: string
  recipient: { firstName: string | null; fields: Record<string, string> }
  unsubscribeUrl: string
}

export type RenderedEmail = { subject: string; html: string; text: string }

const marked = new Marked({ gfm: true, breaks: true, async: false })

// {{first_name}}, {{first_name|there}}, {{fields.plan|free}}
const MERGE_TAG = /\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g

export function renderEmail(input: RenderInput): RenderedEmail {
  const value = (tag: string) => {
    if (tag === "first_name") return input.recipient.firstName?.trim() || null
    if (tag.startsWith("fields.")) return input.recipient.fields[tag.slice(7)] || null
    return null
  }
  // The fallback is part of the template, so in HTML it's already escaped; only contact data is.
  const merge = (template: string, escape: (text: string) => string) =>
    template.replace(MERGE_TAG, (_, tag: string, fallback = "") => {
      const filled = value(tag)
      return filled === null ? fallback.trim() : escape(filled)
    })

  const html = input.format === "text" ? `<div style="white-space:pre-wrap;">${escapeHtml(input.body)}</div>` : input.body
  const body = merge(html, escapeHtml)
  const footer = merge(markdownToHtml(input.footer), escapeHtml)
  const subject = merge(input.subject, (text) => text)

  return {
    subject,
    html: layout({
      subject,
      body,
      footer: { html: footer, unsubscribeUrl: input.unsubscribeUrl },
    }),
    text: [
      merge(input.format === "text" ? input.body : htmlToText(input.body), (text) => text),
      "--",
      merge(input.footer, (text) => text),
      `Unsubscribe: ${input.unsubscribeUrl}`,
    ]
      .filter((part) => part.trim())
      .join("\n\n"),
  }
}

/**
 * A single email, like a receipt or a welcome note: Markdown in the same layout as campaigns,
 * without the campaign footer or unsubscribe link.
 */
export function renderMessage(input: { subject: string; markdown: string }): RenderedEmail {
  return {
    subject: input.subject,
    html: layout({ subject: input.subject, body: marked.parse(input.markdown) as string }),
    text: input.markdown,
  }
}

/** Markdown to HTML. marked percent-encodes link URLs, so their merge tags are put back. */
export function markdownToHtml(markdown: string) {
  return (marked.parse(markdown) as string).replace(
    /%7B%7B(.*?)%7D%7D/gi,
    (_, tag: string) => `{{${escapeHtml(decodeURIComponent(tag))}}}`
  )
}

// Elements whose content isn't part of the message.
const HIDDEN = new Set(["head", "title", "style", "script"])
const BLOCKS = new Set([
  ..."p h1 h2 h3 h4 h5 h6 div blockquote ul ol table tr pre hr figure".split(" "),
])

/** The message as plain text: a line per paragraph, heading and list item, links as "text (url)". */
function htmlToText(html: string) {
  return textOf(parseDocument(html).children)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function textOf(nodes: ChildNode[]): string {
  return nodes.map(nodeText).join("")
}

function nodeText(node: ChildNode): string {
  if (isText(node)) return node.data.replace(/\s+/g, " ")
  if (!isTag(node) || HIDDEN.has(node.name)) return ""
  const inner = textOf(node.children).trim()
  const { href, "data-src": src, "data-title": title } = node.attribs
  if (node.name === "br") return "\n"
  if (node.name === "li") return `\n- ${inner}`
  if (node.name === "a" && href && !href.startsWith("#") && href !== inner) {
    return inner ? ` ${inner} (${href}) ` : href
  }
  if (node.name === "figure" && src) return `\n\n${title ? `${title}: ` : ""}${src}\n\n`
  return BLOCKS.has(node.name) ? `\n\n${inner}\n\n` : inner
}

function layout(parts: {
  subject: string
  body: string
  footer?: { html: string; unsubscribeUrl: string }
}) {
  const footer =
    parts.footer &&
    `<div class="sendr-footer" style="margin-top:40px;padding-top:20px;border-top:1px solid #e7e5e4;font-size:13px;line-height:1.5;color:#78716c;">
${parts.footer.html}
<p><a href="${escapeHtml(parts.footer.unsubscribeUrl)}" style="color:#78716c;">Unsubscribe</a></p>
</div>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(parts.subject)}</title>
<style>
  .sendr-body p, .sendr-body ul, .sendr-body ol, .sendr-body blockquote { margin: 0 0 16px; }
  .sendr-body h1, .sendr-body h2, .sendr-body h3 { line-height: 1.3; margin: 28px 0 12px; }
  .sendr-body a { color: #2563eb; }
  .sendr-body img { max-width: 100%; height: auto; border-radius: 8px; }
  .sendr-body blockquote { border-left: 3px solid #d6d3d1; padding-left: 14px; color: #57534e; }
  .sendr-body code { font-family: ui-monospace, Menlo, monospace; font-size: 14px; background: #f5f5f4; padding: 1px 4px; border-radius: 4px; }
  .sendr-footer p { margin: 0 0 8px; }
  .sendr-footer a { color: #78716c; }
</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1c1917;">
<div class="sendr-body">${parts.body}</div>
${footer ?? ""}
</div>
</body>
</html>`
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
