import { RotateCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/** Stands in for a page's content when its request failed, so a blip never reads as "empty". */
export function LoadError({
  message = "Check your connection, then try again.",
  onRetry,
  retrying,
}: {
  /** Why it failed, when the server said; a connection problem otherwise. */
  message?: string
  onRetry: () => unknown
  retrying: boolean
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-4 py-16">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Couldn't load this</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" onClick={onRetry} disabled={retrying}>
        {retrying ? <Spinner /> : <RotateCwIcon />}
        Retry
      </Button>
    </div>
  )
}
