import { isTag, isText, type ChildNode, type Element } from "domhandler"
import { parseDocument } from "htmlparser2"
import { Marked } from "marked"

import type { CampaignFormat } from "./model"

/**
 * Renders a campaign for one recipient. Shared by sending and the admin app's live preview, so
 * it runs in both the Worker and the browser.
 */
export type RenderInput = {
  subject: string
  format: CampaignFormat
  body: string
  footer: string
  recipient: { firstName: string | null; fields: Record<string, string> }
  unsubscribeUrl: string
}

/** `html` is null for a text campaign, which is sent without an HTML part. */
export type RenderedEmail = { subject: string; html: string | null; text: string }

/** The footer from settings (Markdown) with the recipient's unsubscribe link. */
type Footer = { markdown: string; unsubscribeUrl: string }

const marked = new Marked({ gfm: true, breaks: true, async: false })

/** {{first_name}}, {{first_name|there}}, {{fields.plan|free}}: the tag, then its fallback. */
export const MERGE_TAG =/\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g

/** Each format's HTML part with the footer, merge tags still in it; a text campaign has none. */
const HTML_PART: Record<CampaignFormat, (body: string, subject: string, footer: Footer) => string | null> = {
  editor: (body, subject, footer) =>
    layout(subject, renderNodes(parseDocument(body).children), footerBlock(footer)),
  html: (body, _, footer) => insertFooter(body, footerBlock(footer)),
  text: () => null,
}

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
  const plain = (text: string) => text

  const footer = { markdown: input.footer, unsubscribeUrl: input.unsubscribeUrl }
  const html = HTML_PART[input.format](input.body, input.subject, footer)
  return {
    subject: merge(input.subject, plain),
    html: html && merge(html, escapeHtml),
    text: merge(withFooterText(bodyToText(input.format, input.body), footer), plain),
  }
}

/**
 * An editor body as a whole document in the campaign layout, for switching a campaign to the
 * html format. Merge tags stay in, and sending adds the footer.
 */
export function editorBodyToHtml(subject: string, body: string) {
  return layout(subject, renderNodes(parseDocument(body).children))
}

/** A body as plain text with its merge tags, for switching a campaign to the text format. */
export function bodyToText(format: CampaignFormat, body: string) {
  return format === "text" ? body : htmlToText(parseDocument(body).children)
}

/**
 * A single email, like a receipt or a welcome note: Markdown in the same layout as campaigns,
 * without the campaign footer or unsubscribe link.
 */
export function renderMessage(input: { subject: string; markdown: string }) {
  const nodes = parseDocument(marked.parse(input.markdown) as string).children
  return { subject: input.subject, html: layout(input.subject, renderNodes(nodes)), text: input.markdown }
}

/** Markdown to HTML. marked percent-encodes link URLs, so their merge tags are put back. */
export function markdownToHtml(markdown: string) {
  return (marked.parse(markdown) as string).replace(
    /%7B%7B(.*?)%7D%7D/gi,
    (_, tag: string) => `{{${escapeHtml(decodeURIComponent(tag))}}}`
  )
}

// Light colors are inline; dark ones override them through the sendr-* classes below.
const LIGHT = { bg: "#ffffff", text: "#1c1917", muted: "#78716c", link: "#2563eb", border: "#e7e5e4" }
const DARK = { bg: "#1c1917", text: "#f5f5f4", muted: "#a8a29e", link: "#60a5fa", border: "#44403c" }

const DARK_STYLES: [string, Record<string, string>][] = [
  ["bg", { "background-color": DARK.bg }],
  ["text", { color: DARK.text }],
  ["muted", { color: DARK.muted }],
  ["link", { color: DARK.link }],
  ["border", { "border-color": DARK.border }],
  ["button", { "background-color": DARK.text, "border-color": DARK.text, color: DARK.bg }],
]

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
// The 600px column less its side padding; Outlook ignores max-width, so wider images are capped.
const CONTENT_WIDTH = 552

/** Outlook.com marks the elements it darkens with data-ogsc (text) and data-ogsb (backgrounds). */
function darkCss(prefix = "") {
  return DARK_STYLES.map(([name, declarations]) => {
    const body = Object.entries(declarations).map(([property, color]) => `${property}: ${color} !important;`)
    return `${prefix}.sendr-${name} { ${body.join(" ")} }`
  }).join("\n")
}

function layout(subject: string, body: string, footer = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
${darkCss()}
}
${darkCss("[data-ogsc] ")}
${darkCss("[data-ogsb] ")}
</style>
</head>
<body class="sendr-bg" style="margin:0;padding:0;background-color:${LIGHT.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sendr-bg" bgcolor="${LIGHT.bg}" style="background-color:${LIGHT.bg};">
<tr><td align="center" style="padding:32px 0;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td class="sendr-text" style="padding:0 24px;font-family:${FONT};font-size:16px;line-height:1.6;color:${LIGHT.text};text-align:left;">
${body}
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

function footerBlock({ markdown, unsubscribeUrl }: Footer) {
  // marked's own markup, so these plain tags are the ones it wrote.
  const html = markdownToHtml(markdown)
    .replaceAll("<p>", '<p style="margin:0 0 8px;">')
    .replaceAll('<a href="', `<a class="sendr-muted" style="color:${LIGHT.muted};" href="`)
  return `<div class="sendr-muted sendr-border" style="margin-top:40px;padding-top:20px;border-top:1px solid ${LIGHT.border};font-family:${FONT};font-size:13px;line-height:1.5;color:${LIGHT.muted};">
${html}
<p style="margin:0;"><a href="${escapeHtml(unsubscribeUrl)}" class="sendr-muted" style="color:${LIGHT.muted};text-decoration:underline;">Unsubscribe</a></p>
</div>`
}

/**
 * The footer goes before </body>, in a centered column like the campaign layout's, so it lines
 * up with a typical email. A fragment gets a minimal document around it.
 */
function insertFooter(html: string, block: string) {
  const footer = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:0 0 32px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;"><tr><td style="padding:0 24px;text-align:left;">${block}</td></tr></table></td></tr></table>`
  const end = html.search(/<\/body\s*>/i)
  if (end !== -1) return `${html.slice(0, end)}${footer}\n${html.slice(end)}`
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
${html}
${footer}
</body>
</html>`
}

function withFooterText(body: string, { markdown, unsubscribeUrl }: Footer) {
  return [body, "--", markdown, `Unsubscribe: ${unsubscribeUrl}`]
    .filter((part) => part.trim())
    .join("\n\n")
}

// The editor's HTML subset, styled inline for email clients. Other tags pass through as written.
const ELEMENTS: Record<string, (node: Element) => string> = {
  h1: heading(28),
  h2: heading(22),
  h3: heading(18),
  p: (node) => {
    const [only, ...rest] = node.children.filter((child) => !isBlank(child))
    if (!rest.length && only && isTag(only) && isButton(only)) return button(only)
    // An empty paragraph is a blank line in the editor, so it's one in the email too.
    return tag("p", { style: "margin:0 0 16px;" }, only ? renderNodes(node.children) : "&nbsp;")
  },
  a: (node) =>
    isButton(node)
      ? button(node)
      : tag(
          "a",
          { href: node.attribs.href, class: "sendr-link", style: `color:${LIGHT.link};text-decoration:underline;` },
          renderNodes(node.children)
        ),
  ul: list,
  ol: list,
  li: (node) => tag("li", { style: "margin:0 0 6px;" }, renderNodes(node.children)),
  blockquote: (node) =>
    tag(
      "blockquote",
      {
        class: "sendr-muted sendr-border",
        style: `margin:0 0 16px;padding:2px 0 2px 16px;border-left:3px solid ${LIGHT.border};color:${LIGHT.muted};`,
      },
      renderNodes(node.children)
    ),
  img: ({ attribs: { src, alt, width } }) =>
    tag("img", {
      src,
      alt: alt ?? "",
      width: width ? String(Math.min(Number.parseInt(width) || CONTENT_WIDTH, CONTENT_WIDTH)) : undefined,
      style: "display:block;max-width:100%;height:auto;border:0;border-radius:8px;margin:0 0 16px;",
    }),
  hr: () =>
    tag("hr", {
      class: "sendr-border",
      style: `height:0;margin:28px 0;border:0;border-top:1px solid ${LIGHT.border};`,
    }),
  figure: (node) => {
    const { "data-media": kind, "data-src": src } = node.attribs
    const card = kind === "video" ? videoCard : kind === "audio" ? audioCard : null
    return card && src ? card(node.attribs, src) : passThrough(node)
  },
}

const VOID_ELEMENTS = new Set(["area", "br", "col", "embed", "hr", "img", "input", "source", "track", "wbr"])

function renderNodes(nodes: ChildNode[]): string {
  return nodes.map(renderNode).join("")
}

function renderNode(node: ChildNode): string {
  if (isText(node)) return escapeHtml(node.data)
  if (!isTag(node)) return ""
  return (ELEMENTS[node.name] ?? passThrough)(node)
}

function passThrough(node: Element) {
  return tag(node.name, node.attribs, VOID_ELEMENTS.has(node.name) ? undefined : renderNodes(node.children))
}

/** An element with escaped attributes; undefined ones are left out, and void elements have no `inner`. */
function tag(name: string, attributes: Record<string, string | undefined>, inner?: string) {
  const attrs = Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}="${escapeHtml(value!)}"`)
    .join("")
  return inner === undefined ? `<${name}${attrs}>` : `<${name}${attrs}>${inner}</${name}>`
}

function heading(size: number) {
  return (node: Element) => {
    // The first block sits at the top of the email, without the gap that separates sections.
    const top = isFirst(node) ? 0 : 28
    const style = `margin:${top}px 0 12px;font-size:${size}px;line-height:1.3;font-weight:700;`
    return tag(node.name, { style }, renderNodes(node.children))
  }
}

function list(node: Element) {
  return tag(node.name, { style: "margin:0 0 16px;padding:0 0 0 24px;" }, renderNodes(node.children))
}

/** A table "bulletproof" button: the whole padded cell is the link, in every client. */
function button(node: Element) {
  const fill = `background-color:${LIGHT.text};border:1px solid ${LIGHT.text};border-radius:8px;`
  const link = tag(
    "a",
    {
      href: node.attribs.href,
      // Kept so the editor reads the button back from the HTML document.
      "data-button": "",
      class: "sendr-button",
      style: `display:inline-block;padding:12px 24px;${fill}color:${LIGHT.bg};font-size:16px;font-weight:600;line-height:1.25;text-decoration:none;`,
    },
    renderNodes(node.children)
  )
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td class="sendr-button" bgcolor="${LIGHT.text}" style="${fill}">${link}</td></tr></table>`
}

type MediaAttributes = Record<string, string | undefined>

/** A poster (or a dark 16:9 block) with a play badge, then the title; the whole card links to the video. */
function videoCard(media: MediaAttributes, src: string) {
  const poster = media["data-poster"]
  const height = Math.round((CONTENT_WIDTH * 9) / 16)
  const backdrop = poster
    ? `background-image:url("${poster}");background-size:cover;background-position:center;`
    : ""
  const badge = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td aria-hidden="true" width="64" height="64" align="center" valign="middle" bgcolor="#ffffff" style="width:64px;height:64px;border-radius:32px;background-color:#ffffff;color:${LIGHT.text};font-size:22px;line-height:64px;text-indent:4px;">${PLAY}</td></tr></table>`
  const frame = tag(
    "td",
    {
      height: String(height),
      align: "center",
      valign: "middle",
      bgcolor: DARK.bg,
      background: poster,
      style: `height:${height}px;border-radius:12px;background-color:${DARK.bg};${backdrop}`,
    },
    badge
  )
  const caption = mediaCaption(media, src, "")
  // The caption is a row of the table: a title link after it, outside a cell, would make
  // browsers split the card's link in two.
  return cardLink(
    media,
    src,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr>${frame}</tr>${
      caption &&
      `<tr><td class="sendr-text" style="padding:10px 0 0;color:${LIGHT.text};line-height:1.4;">${caption}</td></tr>`
    }</table>`
  )
}

/** A compact row: play circle, title, duration; the whole card links to the audio. */
function audioCard(media: MediaAttributes, src: string) {
  const circle = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td aria-hidden="true" class="sendr-button" width="40" height="40" align="center" valign="middle" bgcolor="${LIGHT.text}" style="width:40px;height:40px;border-radius:20px;background-color:${LIGHT.text};color:${LIGHT.bg};font-size:14px;line-height:40px;text-indent:2px;">${PLAY}</td></tr></table>`
  return cardLink(
    media,
    src,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sendr-border" style="border:1px solid ${LIGHT.border};border-radius:12px;border-collapse:separate;"><tr><td width="52" style="width:40px;padding:12px 0 12px 12px;">${circle}</td><td class="sendr-text" style="padding:12px 16px 12px 12px;color:${LIGHT.text};line-height:1.4;">${mediaCaption(media, src, "Listen")}</td></tr></table>`
  )
}

const CARD_DATA = ["data-media", "data-src", "data-poster", "data-title", "data-duration"]

/** The card's link, carrying the card's attributes so the editor reads it back as a card. */
function cardLink(media: MediaAttributes, src: string, inner: string) {
  const data = Object.fromEntries(CARD_DATA.map((name) => [name, media[name]]))
  return tag("a", { href: src, ...data, style: "display:block;margin:0 0 16px;text-decoration:none;" }, inner)
}

// U+FE0E keeps iOS from drawing the triangle as an emoji.
const PLAY = "&#9654;&#65038;"

/** The title links too: Outlook on Windows ignores a link around blocks, like the card's. */
function mediaCaption(media: MediaAttributes, src: string, fallbackTitle: string) {
  const title = media["data-title"] || fallbackTitle
  const duration = media["data-duration"]
  const strong = title && `<strong style="font-weight:600;">${escapeHtml(title)}</strong>`
  return [
    strong &&
      tag("a", { href: src, class: "sendr-text", style: `color:${LIGHT.text};text-decoration:none;` }, strong),
    duration && `<span class="sendr-muted" style="color:${LIGHT.muted};">${escapeHtml(duration)}</span>`,
  ]
    .filter(Boolean)
    .join(" &middot; ")
}

function isButton(node: Element) {
  return node.name === "a" && "data-button" in node.attribs
}

function isBlank(node: ChildNode) {
  return isText(node) && !node.data.trim()
}

function isFirst(node: Element) {
  let previous = node.prev
  while (previous && isBlank(previous)) previous = previous.prev
  return !previous && (!node.parent || node.parent.type === "root")
}

// Elements whose content isn't part of the message.
const HIDDEN = new Set(["head", "title", "style", "script"])
const BLOCKS = new Set([
  ..."p h1 h2 h3 h4 h5 h6 div blockquote ul ol table tr pre hr figure".split(" "),
])

/** The message as plain text: a line per paragraph, heading and list item, links as "text (url)". */
function htmlToText(nodes: ChildNode[]) {
  return textOf(nodes)
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function textOf(nodes: ChildNode[]): string {
  return nodes.map(nodeText).join("")
}

function nodeText(node: ChildNode): string {
  if (isText(node)) return node.data.replace(/\s+/g, " ")
  // Decorations, like a card's play badge, aren't part of the message.
  if (!isTag(node) || HIDDEN.has(node.name) || node.attribs["aria-hidden"] === "true") return ""
  const inner = textOf(node.children).trim()
  const { href, "data-src": src, "data-title": title } = node.attribs
  if (node.name === "br") return "\n"
  if (node.name === "li") return `\n- ${inner}`
  if (node.name === "a" && href && !href.startsWith("#") && href !== inner && !insideLink(node, href)) {
    // A link around blocks, like a rendered media card, is a block of its own.
    if (node.children.some((child) => isTag(child) && BLOCKS.has(child.name))) {
      return `\n\n${inner ? `${inner} (${href})` : href}\n\n`
    }
    return inner ? ` ${inner} (${href}) ` : href
  }
  if (node.name === "figure" && src) return `\n\n${title ? `${title}: ` : ""}${src}\n\n`
  return BLOCKS.has(node.name) ? `\n\n${inner}\n\n` : inner
}

/** A link inside another to the same place, like a media card's title, is part of that one. */
function insideLink(node: Element, href: string) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isTag(parent) && parent.name === "a" && parent.attribs.href === href) return true
  }
  return false
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
