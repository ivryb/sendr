import { StrictMode } from "react"
import { hydrateRoot } from "react-dom/client"
import { hydrate, type DehydratedState } from "@tanstack/react-query"
import { createBrowserRouter, RouterProvider } from "react-router"

import "./index.css"
import { AppProviders, createRoutes } from "./App.tsx"
import { createQueryClient } from "@/lib/query-client"
import { rememberTimeZone } from "@/lib/ssr"

declare global {
  /** Query data the server rendered the page with (see src/entry-server.tsx). */
  var __SENDR_STATE__: DehydratedState | undefined
}

rememberTimeZone()
const queryClient = createQueryClient()
hydrate(queryClient, globalThis.__SENDR_STATE__ ?? {})

hydrateRoot(
  document.getElementById("root")!,
  <StrictMode>
    <AppProviders client={queryClient}>
      <RouterProvider router={createBrowserRouter(createRoutes(queryClient))} />
    </AppProviders>
  </StrictMode>
)
