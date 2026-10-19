import type { ReactNode } from "react"
import {
  QueryClientProvider,
  useQuery,
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query"
import { Outlet, redirect, type RouteObject } from "react-router"

import { AppShell } from "@/components/app-shell"
import { LoadError } from "@/components/load-error"
import { Toaster } from "@/components/ui/sonner"
import { Spinner } from "@/components/ui/spinner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { contactCounts, CONTACTS_PAGE_SIZE, queries } from "@/lib/api"
import { CampaignPage } from "@/pages/campaign"
import { CampaignsPage } from "@/pages/campaigns"
import { ContactsPage } from "@/pages/contacts"
import { SettingsPage } from "@/pages/settings"
import { SignInPage } from "@/pages/sign-in"

/** Shows sign-in in place, so a deep link opens once the admin is signed in. */
function AuthGate() {
  const setup = useQuery(queries.setup)
  const me = useQuery(queries.me)
  if (setup.isPending || me.isPending) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Spinner className="text-muted-foreground" />
      </div>
    )
  }
  // A failed check must not fall through to sign-in: an outage isn't "signed out".
  const failed = [setup, me].find((query) => query.isError)
  if (failed) {
    return (
      <div className="mx-auto w-full max-w-sm px-5 pt-[14vh]">
        <LoadError query={failed} />
      </div>
    )
  }
  if (!me.data) return <SignInPage firstSignIn={!setup.data?.claimed} />
  return <Outlet />
}

type Load = (client: QueryClient) => Promise<void>

/** Route data the server loads before rendering, so the first paint is the finished page. */
export type RouteHandle = {
  load: (params: Record<string, string | undefined>) => Load[]
}

function load<T, K extends QueryKey>(
  query: FetchQueryOptions<T, Error, T, K>
): Load {
  return (client) => client.prefetchQuery(query)
}

const toCampaigns = () => redirect("/campaigns")

export const routes: RouteObject[] = [
  {
    element: <AuthGate />,
    handle: {
      load: () => [load(queries.setup), load(queries.me)],
    } satisfies RouteHandle,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, loader: toCampaigns },
          {
            path: "campaigns",
            element: <CampaignsPage />,
            handle: {
              load: () => [
                load(queries.campaigns),
                load(queries.settings),
                load(contactCounts),
              ],
            } satisfies RouteHandle,
          },
          {
            path: "campaigns/:id",
            element: <CampaignPage />,
            handle: {
              load: ({ id }) => [
                load(queries.campaign(id!)),
                load(queries.settings),
              ],
            } satisfies RouteHandle,
          },
          {
            path: "contacts",
            element: <ContactsPage />,
            handle: {
              load: () => [
                load(
                  queries.contacts({ limit: CONTACTS_PAGE_SIZE, offset: 0 })
                ),
                load(queries.settings),
              ],
            } satisfies RouteHandle,
          },
          {
            path: "settings",
            element: <SettingsPage />,
            handle: {
              load: () => [
                load(queries.settings),
                load(queries.apiKeys),
                load(queries.passkeys),
              ],
            } satisfies RouteHandle,
          },
          { path: "*", loader: toCampaigns },
        ],
      },
    ],
  },
]

/** Everything around the router, shared by the server render and the browser. */
export function AppProviders({
  client,
  children,
}: {
  client: QueryClient
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {children}
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
