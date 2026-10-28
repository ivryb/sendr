import { EditorContent, useEditor } from "@tiptap/react"
import { cn } from "cn"

import { editorBody, editorContent, EXTENSIONS } from "./extensions"
import { Toolbar } from "./toolbar"
import "./editor.css"

/**
 * The campaign's rich editor, styled like the email it becomes. Its own chunk: the editor
 * library is large, so the page loads it on demand.
 */
export default function RichEditor({
  body,
  converted = false,
  onChange,
  className,
}: {
  body: string
  /** The body was just converted from another format, so it's saved as the editor reads it. */
  converted?: boolean
  onChange: (body: string) => void
  className?: string
}) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: editorContent(body),
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "email-doc", "aria-label": "Message" },
    },
    // Only a real edit or a switch from another format saves. Saving the body as the editor
    // reads it on every open would rewrite a draft just by viewing it, dropping any tags
    // outside the editor's subset.
    onCreate: ({ editor }) => {
      if (converted) onChange(editorBody(editor))
    },
    onUpdate: ({ editor }) => onChange(editorBody(editor)),
  })

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl bg-white text-stone-900 shadow-xs ring-1 ring-stone-200 lg:overflow-auto dark:ring-white/10",
        className
      )}
    >
      {editor ? <Toolbar editor={editor} /> : <div className="h-10 border-b border-stone-100" />}
      <EditorContent
        editor={editor}
        className="flex flex-1 flex-col px-5 py-6 sm:px-10 sm:py-8"
      />
    </div>
  )
}
