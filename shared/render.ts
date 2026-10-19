import { Marked } from "marked"

/** Renders a campaign for one recipient. Shared by sending and the admin app's live preview. */
export type RenderInput = {
  subject: string
  markdown: string
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
  const merge = (template: string, escape: (text: string) => string) =>
    template.replace(MERGE_TAG, (_, tag: string, fallback = "") =>
      escape(value(tag) ?? fallback.trim())
    )

  const body = merge(marked.parse(input.markdown) as string, escapeHtml)
  const footer = merge(marked.parse(input.footer) as string, escapeHtml)
  const subject = merge(input.subject, (text) => text)

  return {
    subject,
    html: layout({ subject, body, footer, unsubscribeUrl: input.unsubscribeUrl }),
    text: [
      merge(input.markdown, (text) => text),
      "--",
      merge(input.footer, (text) => text),
      `Unsubscribe: ${input.unsubscribeUrl}`,
    ]
      .filter((part) => part.trim())
      .join("\n\n"),
  }
}

function layout(parts: {
  subject: string
  body: string
  footer: string
  unsubscribeUrl: string
}) {
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
<div class="sendr-footer" style="margin-top:40px;padding-top:20px;border-top:1px solid #e7e5e4;font-size:13px;line-height:1.5;color:#78716c;">
${parts.footer}
<p><a href="${escapeHtml(parts.unsubscribeUrl)}" style="color:#78716c;">Unsubscribe</a></p>
</div>
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
