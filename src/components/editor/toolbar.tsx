import { useRef, useState, type MouseEvent, type ReactNode } from "react"
import type { Editor } from "@tiptap/core"
import { useEditorState } from "@tiptap/react"
import {
  BoldIcon,
  BracesIcon,
  CheckIcon,
  ChevronDownIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  MinusIcon,
  QuoteIcon,
  RectangleHorizontalIcon,
  XIcon,
} from "lucide-react"
import { cn } from "cn"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { uploadFiles } from "./uploads"

const STYLES = [
  { label: "Paragraph", level: null },
  { label: "Heading 1", level: 1 },
  { label: "Heading 2", level: 2 },
  { label: "Heading 3", level: 3 },
] as const

type Level = (typeof STYLES)[number]["level"]

const TOOL =
  "inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-[13px] whitespace-nowrap text-stone-600 transition-colors outline-none hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-300 aria-pressed:bg-stone-100 aria-pressed:text-stone-900 aria-expanded:bg-stone-100 [&_svg]:size-4 [&_svg]:shrink-0"

/** The formatting bar pinned to the top of the editor card. */
export function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      level: ([1, 2, 3] as const).find((level) => editor.isActive("heading", { level })) ?? null,
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      link: editor.isActive("link"),
      bulletList: editor.isActive("bulletList"),
      blockquote: editor.isActive("blockquote"),
      button: editor.isActive("button"),
    }),
  })
  // The address being typed for the selected link or button; null while the tools show.
  const [href, setHref] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const chain = () => editor.chain().focus()

  const editLink = () => {
    const { href } = editor.getAttributes(state.button ? "button" : "link")
    setHref(typeof href === "string" ? href : "")
  }

  const applyLink = (next: string | null) => {
    setHref(null)
    // Right away, so typing on after Enter goes into the editor.
    editor.view.focus()
    if (next === null) return
    if (state.button) chain().updateAttributes("button", { href: next }).run()
    else if (!next) chain().extendMarkRange("link").unsetLink().run()
    else if (editor.state.selection.empty && !state.link) {
      const link = { type: "link", attrs: { href: next } }
      chain().insertContent({ type: "text", text: next, marks: [link] }).run()
    } else chain().extendMarkRange("link").setLink({ href: next }).run()
  }

  return (
    <div className="sticky top-0 z-10 flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-stone-100 bg-white/95 px-2 backdrop-blur [scrollbar-width:none] max-lg:rounded-t-xl">
      {href !== null ? (
        <LinkField value={href} onChange={setHref} canRemove={state.link} onDone={applyLink} />
      ) : (
        <>
          <StyleMenu editor={editor} level={state.level} />
          <Separator />
          <Tool label="Bold" active={state.bold} onClick={() => chain().toggleBold().run()}>
            <BoldIcon />
          </Tool>
          <Tool label="Italic" active={state.italic} onClick={() => chain().toggleItalic().run()}>
            <ItalicIcon />
          </Tool>
          <Tool label="Link" active={state.link} onClick={editLink}>
            <LinkIcon />
          </Tool>
          <Tool
            label="Bulleted list"
            active={state.bulletList}
            onClick={() => chain().toggleBulletList().run()}
          >
            <ListIcon />
          </Tool>
          <Tool
            label="Quote"
            active={state.blockquote}
            onClick={() => chain().toggleBlockquote().run()}
          >
            <QuoteIcon />
          </Tool>
          <Separator />
          <Tool
            label="Button"
            active={state.button}
            onClick={() => {
              chain().toggleNode("button", "paragraph").run()
              if (!state.button) setHref("")
            }}
          >
            <RectangleHorizontalIcon />
          </Tool>
          <Tool label="Image, video or audio" onClick={() => picker.current?.click()}>
            <ImageIcon />
          </Tool>
          <Tool label="Divider" onClick={() => chain().setHorizontalRule().run()}>
            <MinusIcon />
          </Tool>
          <span className="min-w-2 flex-1" />
          <PersonalizeMenu editor={editor} />
          <input
            ref={picker}
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])]
              event.target.value = ""
              void uploadFiles(editor, files)
            }}
          />
        </>
      )}
    </div>
  )
}

/** `onDone` gets the address to apply, "" to remove the link, or null to leave it as it was. */
function LinkField({
  value,
  onChange,
  canRemove,
  onDone,
}: {
  value: string
  onChange: (value: string) => void
  canRemove: boolean
  onDone: (href: string | null) => void
}) {
  return (
    <form
      className="flex flex-1 items-center gap-1.5 px-1"
      onSubmit={(event) => {
        event.preventDefault()
        onDone(value.trim())
      }}
    >
      <LinkIcon className="size-4 shrink-0 text-stone-400" />
      <input
        autoFocus
        type="text"
        inputMode="url"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone(null)
          // Handled here, so the Enter doesn't also reach the editor once it has focus again.
          if (event.key === "Enter") {
            event.preventDefault()
            onDone(value.trim())
          }
        }}
        placeholder="https://example.com"
        aria-label="Link address"
        className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-stone-400"
      />
      {canRemove && (
        <Tool label="Remove link" onClick={() => onDone("")}>
          <XIcon />
        </Tool>
      )}
      <button
        type="submit"
        className="h-7 shrink-0 rounded-md bg-stone-900 px-2.5 text-xs font-medium text-white hover:bg-stone-800"
      >
        Apply
      </button>
    </form>
  )
}

function StyleMenu({ editor, level }: { editor: Editor; level: Level }) {
  const current = STYLES.find((style) => style.level === level) ?? STYLES[0]
  const apply = (next: Level) =>
    next
      ? editor.chain().focus().setHeading({ level: next }).run()
      : editor.chain().focus().setParagraph().run()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" onMouseDown={keepSelection} className={cn(TOOL, "px-2 font-medium text-stone-700")} />}
      >
        {current.label}
        <ChevronDownIcon className="!size-3.5 text-stone-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40" finalFocus={backToEditor(editor)}>
        {STYLES.map((style) => (
          <DropdownMenuItem key={style.label} onClick={() => apply(style.level)}>
            {style.label}
            {style.level === level && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PersonalizeMenu({ editor }: { editor: Editor }) {
  const insert = (name: string, fallback: string) =>
    editor.chain().focus().insertContent({ type: "mergeTag", attrs: { name, fallback } }).run()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" onMouseDown={keepSelection} className={cn(TOOL, "px-2 text-stone-700")} />}
      >
        <BracesIcon className="text-stone-400" />
        Personalize
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" finalFocus={backToEditor(editor)}>
        <DropdownMenuItem onClick={() => insert("first_name", "there")}>
          First name
          <span className="ml-auto text-xs text-muted-foreground">or “there”</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs/relaxed text-muted-foreground">
          For any contact field, type{" "}
          <code className="font-mono text-foreground">{"{{fields.plan|free}}"}</code>. The text after
          the bar shows when a contact has no value.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Tool({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={keepSelection}
      onClick={onClick}
      className={TOOL}
    >
      {children}
    </button>
  )
}

/** Pressing a tool leaves the editor focused, so its selection stays what the tool acts on. */
function keepSelection(event: MouseEvent) {
  event.preventDefault()
}

/** A closing menu gives focus back to the editor's selection, instead of to the menu's button. */
function backToEditor(editor: Editor) {
  return () => {
    editor.view.focus()
    return false
  }
}

function Separator() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-stone-200" />
}
