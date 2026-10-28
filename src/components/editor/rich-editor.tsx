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
  onChange,
  className,
}: {
  body: string
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
    // A body written elsewhere (Markdown from the API, converted HTML) is saved in the editor's form.
    onCreate: ({ editor }) => {
      const normalized = editorBody(editor)
      if (normalized !== body) onChange(normalized)
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
