import { useQuery } from "@tanstack/react-query"
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
} from "react-router"

import { AppShell } from "@/components/app-shell"
import { Spinner } from "@/components/ui/spinner"
import { queries } from "@/lib/api"
import { CampaignPage } from "@/pages/campaign"
import { CampaignsPage } from "@/pages/campaigns"
import { ContactsPage } from "@/pages/contacts"
import { SettingsPage } from "@/pages/settings"
import { SetupPage } from "@/pages/setup"
import { SignInPage } from "@/pages/sign-in"

/** Shows setup or sign-in in place, so a deep link opens once the admin is signed in. */
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
  if (!setup.data?.claimed) return <SetupPage />
  if (!me.data) return <SignInPage />
  return <Outlet />
}

const router = createBrowserRouter([
  {
    element: <AuthGate />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/campaigns" replace /> },
          { path: "campaigns", element: <CampaignsPage /> },
          { path: "campaigns/:id", element: <CampaignPage /> },
          { path: "contacts", element: <ContactsPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "*", element: <Navigate to="/campaigns" replace /> },
        ],
      },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
