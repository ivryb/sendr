import { SendIcon } from "lucide-react"
import { cn } from "cn"

export function Logo({
  className,
  nameClassName,
}: {
  className?: string
  nameClassName?: string
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-2 font-semibold", className)}
    >
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
        <SendIcon className="size-3.5 -translate-x-px translate-y-px" />
      </span>
      <span className={cn("tracking-tight", nameClassName)}>Sendr</span>
    </span>
  )
}
