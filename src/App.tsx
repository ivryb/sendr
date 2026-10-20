import type { ReactNode } from "react"
import {
  QueryClientProvider,
  useSuspenseQuery,
  type QueryClient,
} from "@tanstack/react-query"
import {
  data,
  Outlet,
  redirect,
  type LoaderFunction,
  type Params,
  type RouteObject,
} from "react-router"

import { AppShell } from "@/components/app-shell"
import { RouteError } from "@/components/route-error"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ApiError, contactCounts, CONTACTS_PAGE_SIZE, queries } from "@/lib/api"
import { CampaignPage } from "@/pages/campaign"
import { CampaignsPage } from "@/pages/campaigns"
import { ContactsPage } from "@/pages/contacts"
import { SettingsPage } from "@/pages/settings"
import { SignInPage } from "@/pages/sign-in"

/** Shows sign-in in place, so a deep link opens once the admin is signed in. */
function AuthGate() {
  const setup = useSuspenseQuery(queries.setup).data
  const me = useSuspenseQuery(queries.me).data
  if (!me) return <SignInPage firstSignIn={!setup.claimed} />
  return <Outlet />
}

const toCampaigns = () => redirect("/campaigns")

/**
 * Every route loads its data into the query cache before it renders, on the server and on
 * client navigation alike, so pages never show a loading state; they read the cache with
 * useSuspenseQuery.
 */
export function createRoutes(client: QueryClient): RouteObject[] {
  const page =
    (load: (params: Params) => Promise<unknown>[]): LoaderFunction =>
    async ({ params }) => {
      try {
        await Promise.all(load(params))
      } catch (error) {
        // Signed out: the auth gate shows sign-in, which reruns this loader once signed in.
        if (error instanceof ApiError && error.status === 401) return null
        if (error instanceof ApiError && error.status === 404) {
          throw data(null, { status: 404 })
        }
        throw error
      }
      return null
    }

  return [
    {
      element: <AuthGate />,
      errorElement: <RouteError fullPage />,
      loader: async () => {
        await Promise.all([
          client.ensureQueryData(queries.setup),
          client.ensureQueryData(queries.me),
        ])
        return null
      },
      children: [
        {
          element: <AppShell />,
          children: [
            {
              errorElement: <RouteError />,
              children: [
                { index: true, loader: toCampaigns },
                {
                  path: "campaigns",
                  element: <CampaignsPage />,
                  loader: page(() => [
                    client.ensureQueryData(queries.campaigns),
                    client.ensureQueryData(queries.settings),
                    client.ensureQueryData(contactCounts),
                  ]),
                },
                {
                  path: "campaigns/:id",
                  element: <CampaignPage />,
                  loader: page(({ id }) => [
                    client.ensureQueryData(queries.campaign(id!)),
                    client.ensureQueryData(queries.settings),
                  ]),
                },
                {
                  path: "contacts",
                  element: <ContactsPage />,
                  loader: page(() => [
                    client.ensureQueryData(
                      queries.contacts({ limit: CONTACTS_PAGE_SIZE, offset: 0 })
                    ),
                    client.ensureQueryData(queries.settings),
                  ]),
                },
                {
                  path: "settings",
                  element: <SettingsPage />,
                  loader: page(() => [
                    client.ensureQueryData(queries.settings),
                    client.ensureQueryData(queries.apiKeys),
                    client.ensureQueryData(queries.passkeys),
                  ]),
                },
                { path: "*", loader: toCampaigns },
              ],
            },
          ],
        },
      ],
    },
  ]
}

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
