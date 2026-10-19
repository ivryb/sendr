import { cn } from "cn"

import { CopyButton } from "@/components/copy-button"

export function CodeBlock({
  code,
  className,
}: {
  code: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative rounded-lg bg-muted/60 ring-1 ring-foreground/5",
        className
      )}
    >
      <pre className="overflow-x-auto px-4 py-3 pr-24 font-mono text-[12.5px]/relaxed">
        <code>{code}</code>
      </pre>
      <div className="absolute top-2 right-2">
        <CopyButton value={code} />
      </div>
    </div>
  )
}
