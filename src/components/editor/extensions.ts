import { Divider, Heading, StarterKit } from "@react-email/editor/extensions"
import {
  Node,
  nodeInputRule,
  nodePasteRule,
  type Attribute,
  type Editor,
} from "@tiptap/core"
import { Link } from "@tiptap/extension-link"
import { Placeholder } from "@tiptap/extensions"
import { DOMSerializer } from "@tiptap/pm/model"

import { MERGE_TAG } from "../../../shared/render"
import { buttonView, mediaCardView, mergeTagView } from "./node-views"
import { Uploads } from "./uploads"

/**
 * The editor speaks the renderer's HTML subset (see shared/render.ts): what it saves is what
 * Sendr lays out for email clients, and anything the renderer understands loads back intact.
 */

/**
 * `{{name|fallback}}` as a chip. It's a span in the editor's HTML, which the clipboard keeps,
 * and plain text in the stored body, where the renderer fills it in.
 */
const MergeTag = Node.create({
  name: "mergeTag",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({
    name: dataAttribute("name", "first_name", "merge-tag"),
    fallback: dataAttribute("fallback", ""),
  }),
  parseHTML: () => [{ tag: "span[data-merge-tag]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes],
  renderText: ({ node }) => mergeTagText(node.attrs.name, node.attrs.fallback),
  addNodeView: () => mergeTagView,
  addInputRules() {
    const find = new RegExp(`${MERGE_TAG.source}$`)
    return [nodeInputRule({ find, type: this.type, getAttributes: tagAttributes })]
  },
  addPasteRules() {
    return [nodePasteRule({ find: MERGE_TAG, type: this.type, getAttributes: tagAttributes })]
  },
})

/** A call-to-action button: `<a data-button href>`. */
const EmailButton = Node.create({
  name: "button",
  group: "block",
  content: "inline*",
  marks: "",
  defining: true,
  addAttributes: () => ({ href: { default: "" } }),
  // Above the link mark, which also matches <a href>.
  parseHTML: () => [{ tag: "a[data-button]", priority: 1000 }],
  renderHTML: ({ HTMLAttributes }) => ["a", { "data-button": "", ...HTMLAttributes }, 0],
  addNodeView: () => buttonView,
})

/** An image on its own line, at its natural width up to the email's. */
const EmailImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({
    src: { default: "" },
    alt: { default: "" },
    width: { default: null },
  }),
  parseHTML: () => [{ tag: "img[src]" }],
  renderHTML: ({ HTMLAttributes }) => ["img", HTMLAttributes],
})

/** A video or audio card linking to the file: `<figure data-media data-src …>`. */
const MediaCard = Node.create({
  name: "mediaCard",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({
    kind: dataAttribute("kind", "video", "media"),
    src: dataAttribute("src", ""),
    poster: dataAttribute("poster", null),
    title: dataAttribute("title", null),
    duration: dataAttribute("duration", null),
  }),
  // Above the starter kit's catch-all block parsing.
  parseHTML: () => [{ tag: "figure[data-media]", priority: 1000 }],
  renderHTML: ({ HTMLAttributes }) => ["figure", HTMLAttributes],
  addNodeView: () => mediaCardView,
})

export const EXTENSIONS = [
  StarterKit.configure({
    // A paragraph always follows the last block, so there's a line to type on.
    TrailingNode: { node: "paragraph", appendTo: "doc" },
    // Replaced below: React Email draws headings and dividers with React components wrapped
    // in extra elements, and its link writes its theme's inline styles into the link.
    Heading: false,
    Divider: false,
    Link: false,
    // For React Email's bubble menus; it moves the cursor to the top whenever the editor blurs.
    FocusScopes: false,
    // Outside the renderer's subset.
    Button: false,
    Body: false,
    Code: false,
    CodeBlockPrism: false,
    Container: false,
    Div: false,
    Section: false,
    GlobalContent: false,
    PreviewText: false,
    PreservedStyle: false,
    Sup: false,
    Uppercase: false,
    Table: false,
    TableRow: false,
    TableCell: false,
    TableHeader: false,
    TwoColumns: false,
    ThreeColumns: false,
    FourColumns: false,
    ColumnsColumn: false,
    AlignmentAttribute: false,
    ClassAttribute: false,
    StyleAttribute: false,
  }),
  Heading.extend({ addNodeView: null }).configure({ levels: [1, 2, 3] }),
  Divider.extend({ addNodeView: null }),
  // Typing right after a link continues plain text.
  Link.extend({ inclusive: false }).configure({
    openOnClick: false,
    HTMLAttributes: { target: null, rel: null, class: null },
  }),
  Placeholder.configure({
    placeholder: ({ editor, node }) =>
      node.type.name === "button" ? "Button text" : editor.isEmpty ? "Write your email…" : "",
  }),
  MergeTag,
  EmailButton,
  EmailImage,
  MediaCard,
  Uploads,
]

/** A stored body as editor content: its text merge tags become chips; ones in links stay text. */
export function editorContent(body: string) {
  const doc = new DOMParser().parseFromString(body, "text/html")
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  for (const text of texts) {
    const nodes: (string | HTMLElement)[] = []
    let end = 0
    for (const match of text.data.matchAll(MERGE_TAG)) {
      const chip = doc.createElement("span")
      chip.dataset.mergeTag = match[1]
      chip.dataset.fallback = match[2]?.trim() ?? ""
      nodes.push(text.data.slice(end, match.index), chip)
      end = match.index + match[0].length
    }
    if (nodes.length) text.replaceWith(...nodes, text.data.slice(end))
  }
  return doc.body.innerHTML
}

/** The editor's content as a stored body, in the renderer's subset; empty when there's nothing. */
export function editorBody(editor: Editor) {
  if (editor.isEmpty) return ""
  const fragment = DOMSerializer.fromSchema(editor.schema).serializeFragment(
    editor.state.doc.content
  )
  // The starter kit's nodes carry editor classes, which emails don't need.
  fragment.querySelectorAll("[class]").forEach((element) => element.removeAttribute("class"))
  fragment.querySelectorAll<HTMLElement>("span[data-merge-tag]").forEach((chip) => {
    chip.replaceWith(mergeTagText(chip.dataset.mergeTag!, chip.dataset.fallback ?? ""))
  })
  // The renderer spaces paragraphs apart, so a list item's text goes in without one.
  fragment
    .querySelectorAll("li > p:first-child")
    .forEach((paragraph) => paragraph.replaceWith(...paragraph.childNodes))
  // The trailing paragraph only gives the cursor a place after the last block.
  let last = fragment.lastChild
  while (last instanceof HTMLParagraphElement && !last.hasChildNodes()) {
    last.remove()
    last = fragment.lastChild
  }
  const container = document.createElement("div")
  container.appendChild(fragment)
  return container.innerHTML
}

function mergeTagText(name: string, fallback: string) {
  return fallback ? `{{${name}|${fallback}}}` : `{{${name}}}`
}

function tagAttributes(match: RegExpMatchArray) {
  return { name: match[1], fallback: match[2]?.trim() ?? "" }
}

/** An attribute stored as `data-<name>`, left out while it's null. */
function dataAttribute(attribute: string, fallback: string | null, name = attribute): Attribute {
  return {
    default: fallback,
    parseHTML: (element) => element.getAttribute(`data-${name}`) ?? fallback,
    renderHTML: (attributes) => ({ [`data-${name}`]: attributes[attribute] }),
  }
}
