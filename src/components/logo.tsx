import { useId } from "react"
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
      <FilledMailIcon className="size-7" />
      <span className={cn("tracking-tight", nameClassName)}>Sendr</span>
    </span>
  )
}

/**
 * Lucide's "mail", filled: the envelope takes the text color and its flap is cut out, so the
 * background shows through wherever the logo sits.
 */
function FilledMailIcon({ className }: { className?: string }) {
  // Each copy needs its own mask: a mask inside a hidden copy (the mobile header) draws nothing.
  const mask = `flap-${useId().replace(/[^\w-]/g, "")}`
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <mask id={mask}>
        <rect width="24" height="24" fill="white" />
        <path
          d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"
          fill="none"
          stroke="black"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>
      <rect
        x="2"
        y="4"
        width="20"
        height="16"
        rx="2"
        fill="currentColor"
        mask={`url(#${mask})`}
      />
    </svg>
  )
}
