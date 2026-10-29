import {
  isRouteErrorResponse,
  Link,
  useRevalidator,
  useRouteError,
} from "react-router"

import { LoadError } from "@/components/load-error"
import { Button } from "@/components/ui/button"

/** A route's loader failed: a missing record reads as "not here", anything else as retryable. */
export function RouteError({ fullPage = false }: { fullPage?: boolean }) {
  const error = useRouteError()
  const revalidator = useRevalidator()
  const missing = isRouteErrorResponse(error) && error.status === 404
  // A Workers Free limit (src/lib/admin.server.ts) says which one and when it resets.
  const limit =
    isRouteErrorResponse(error) && error.status === 503
      ? (error.data as { message?: string } | null)?.message
      : undefined
  const content = missing ? (
    <div className="flex flex-col items-start gap-4 py-16">
      <h1 className="text-xl font-semibold">This isn't here</h1>
      <p className="text-sm text-muted-foreground">It may have been deleted.</p>
      <Button
        variant="outline"
        nativeButton={false}
        render={<Link to="/campaigns" />}
      >
        Back to campaigns
      </Button>
    </div>
  ) : (
    <LoadError
      message={limit}
      onRetry={() => revalidator.revalidate()}
      retrying={revalidator.state === "loading"}
    />
  )
  // Outside the app shell (sign-in, or the shell itself failing), the message centers itself.
  if (fullPage) {
    return (
      <div className="mx-auto w-full max-w-sm px-5 pt-[14vh]">{content}</div>
    )
  }
  return content
}
