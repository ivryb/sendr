import { useEffect, useState, type ReactNode } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router"

import type { Route } from "./+types/root"
import { RouteError } from "@/components/route-error"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { createQueryClient } from "@/lib/mutations"
import "./index.css"

const TIME_ZONE_COOKIE = "tz"

/** The admin's time zone, which the browser saves in a cookie so the server renders dates in it. */
export function loader({ request }: Route.LoaderArgs) {
  const cookie = request.headers.get("cookie") ?? ""
  const saved = cookie.match(/(?:^|;\s*)tz=([^;]+)/)?.[1]
  return { timeZone: validTimeZone(saved && decodeURIComponent(saved)) }
}

function validTimeZone(timeZone: string | undefined) {
  if (!timeZone) return "UTC"
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return timeZone
  } catch {
    return "UTC"
  }
}

export function useTimeZone() {
  return useRouteLoaderData<typeof loader>("root")?.timeZone ?? "UTC"
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#ffffff" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <title>Sendr</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  const [queryClient] = useState(createQueryClient)
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(timeZone)}; path=/; max-age=31536000; samesite=lax`
  }, [])
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Outlet />
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export function ErrorBoundary() {
  return <RouteError fullPage />
}
