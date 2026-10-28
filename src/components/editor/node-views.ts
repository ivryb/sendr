import type { NodeViewRenderer } from "@tiptap/core"

/** How the editor draws its chips and media cards; editor.css styles them. */

export const mergeTagView: NodeViewRenderer = ({ node }) => {
  const { name, fallback } = node.attrs
  const dom = element("span", "merge-tag", name)
  if (fallback) dom.appendChild(element("span", "merge-tag-fallback", fallback))
  dom.title = fallback
    ? `Each contact's ${name}, or “${fallback}” when they have none`
    : `Each contact's ${name}`
  return { dom }
}

/**
 * The button's label, with where it links beside it. The label isn't drawn as a link: typing at
 * the end of one, browsers put the text after it.
 */
export const buttonView: NodeViewRenderer = ({ node }) => {
  const label = element("div", "email-button")
  const href = element("span", "email-button-href")
  href.contentEditable = "false"
  const showHref = (value: string) => {
    href.textContent = value || "No link yet"
  }
  showHref(node.attrs.href)
  return {
    dom: element("div", "email-button-row", label, href),
    contentDOM: label,
    update: (next) => {
      if (next.type !== node.type) return false
      showHref(next.attrs.href)
      return true
    },
    ignoreMutation: (mutation) => mutation.type !== "selection" && !label.contains(mutation.target),
  }
}

/** A video's poster with a play badge, or an audio row; the title is edited in place. */
export const mediaCardView: NodeViewRenderer = ({ node, editor, getPos }) => {
  const { kind, poster, duration } = node.attrs
  const title = document.createElement("input")
  title.className = "media-title"
  title.placeholder = "Add a title"
  title.value = node.attrs.title ?? ""
  title.addEventListener("input", () => {
    const pos = getPos()
    if (pos === undefined) return
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(pos, "title", title.value.trim() || null)
    )
  })
  const caption = element("span", "media-caption", title)
  if (duration) caption.appendChild(element("span", "media-duration", duration))

  const dom =
    kind === "video"
      ? element("div", "media-card", element("div", "media-frame", image(poster), playBadge(), caption))
      : element("div", "media-card", playBadge(), caption, waveform())
  dom.dataset.kind = kind

  let current = node
  return {
    dom,
    // The title field handles its own typing and clicks.
    stopEvent: (event) => event.target === title,
    ignoreMutation: () => true,
    update: (next) => {
      const changed = Object.keys(next.attrs).filter(
        (key) => next.attrs[key] !== current.attrs[key]
      )
      if (next.type !== current.type || changed.some((key) => key !== "title")) return false
      if (document.activeElement !== title) title.value = next.attrs.title ?? ""
      current = next
      return true
    },
  }
}

/** Shown where a file goes while it uploads; never part of the document. */
export function uploadPlaceholder(file: File, preview: string | null) {
  return element(
    "div",
    "upload-placeholder",
    image(preview),
    element("span", "upload-spinner"),
    element("span", "upload-name", `Uploading ${file.name}…`)
  )
}

function image(src: string | null) {
  if (!src) return ""
  const img = document.createElement("img")
  img.src = src
  img.alt = ""
  return img
}

function playBadge() {
  const badge = element("span", "media-play")
  badge.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
  return badge
}

// Decorative bars, like a podcast player's.
const WAVE = [6, 12, 18, 10, 22, 14, 8, 16, 20, 9, 13, 19, 7, 15, 11, 17, 6, 12]

function waveform() {
  const bars = WAVE.map((height) => {
    const bar = element("span")
    bar.style.height = `${height}px`
    return bar
  })
  return element("span", "media-wave", ...bars)
}

function element(tag: string, className = "", ...children: (Node | string)[]) {
  const node = document.createElement(tag)
  node.className = className
  node.replaceChildren(...children)
  return node
}
