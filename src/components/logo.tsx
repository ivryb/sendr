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
        <FilledMailIcon className="size-[18px]" />
      </span>
      <span className={cn("tracking-tight", nameClassName)}>Sendr</span>
    </span>
  )
}

/**
 * Lucide's "mail", filled: the envelope takes the text color and its flap is cut out in the
 * tile's color. Drawn here because Lucide paints the flap under the envelope.
 */
function FilledMailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" />
      <path
        d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"
        fill="none"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
