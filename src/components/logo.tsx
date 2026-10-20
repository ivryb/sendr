import { InboxIcon } from "lucide-react"
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
      <InboxIcon className="size-6" />
      <span className={cn("tracking-tight", nameClassName)}>Sendr</span>
    </span>
  )
}
