import { cn } from "cn"

import { CopyButton } from "@/components/copy-button"

/** `wrap` breaks long lines, for prose like prompts; code scrolls sideways instead. */
export function CodeBlock({
  code,
  wrap = false,
  className,
}: {
  code: string
  wrap?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative rounded-lg bg-muted/60 ring-1 ring-foreground/5",
        className
      )}
    >
      <pre
        className={cn(
          "overflow-x-auto px-4 py-3 pr-24 font-mono text-[12.5px]/relaxed",
          wrap && "whitespace-pre-wrap"
        )}
      >
        <code>{code}</code>
      </pre>
      <div className="absolute top-2 right-2">
        <CopyButton value={code} />
      </div>
    </div>
  )
}
