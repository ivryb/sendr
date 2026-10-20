import {
  AtSignIcon,
  ChevronsUpDownIcon,
  CodeXmlIcon,
  LogOutIcon,
  MailIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react"
import {
  Link,
  NavLink,
  Outlet,
  useMatch,
  useNavigation,
  useRouteLoaderData,
} from "react-router"

import type { Route } from "./+types/app-shell"

import { Logo } from "@/components/logo"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { adminContext, requireAdmin } from "@/lib/admin.server"
import { authClient } from "@/lib/auth-client"

const NAV = [
  { to: "/campaigns", label: "Campaigns", icon: MailIcon },
  { to: "/contacts", label: "Contacts", icon: UsersIcon },
  { to: "/senders", label: "Senders", icon: AtSignIcon },
  { to: "/api", label: "API", icon: CodeXmlIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
]

// Every page inside the shell is for signed-in admins only.
export const middleware: Route.MiddlewareFunction[] = [requireAdmin]

export function loader({ context }: Route.LoaderArgs) {
  return { admin: context.get(adminContext) }
}

/** The signed-in admin, for any page inside the shell. */
export function useAdmin() {
  return useRouteLoaderData<typeof loader>("components/app-shell")!.admin
}

export default function AppShell() {
  return (
    <SidebarProvider>
      <NavigationProgress />
      <Sidebar variant="inset">
        <SidebarHeader>
          <Link to="/campaigns" aria-label="Sendr home" className="px-2 py-1.5">
            <Logo />
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {NAV.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <AccountMenu />
        </SidebarFooter>
      </Sidebar>
      {/* min-w-0: wide content scrolls inside a page instead of widening the page. */}
      <SidebarInset className="min-w-0">
        <header className="flex h-12 items-center gap-2 border-b px-3 md:hidden">
          <SidebarTrigger />
          <Link to="/campaigns" aria-label="Sendr home">
            <Logo />
          </Link>
        </header>
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-8 sm:py-10">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

/** A thin bar at the top while the next page loads; only slow loads show it. */
function NavigationProgress() {
  if (useNavigation().state === "idle") return null
  return (
    <div className="nav-progress fixed inset-x-0 top-0 z-50 h-0.5 bg-primary" />
  )
}

function NavItem({ to, label, icon: Icon }: (typeof NAV)[number]) {
  const active = Boolean(useMatch({ path: to, end: false }))
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        render={<NavLink to={to} onClick={() => setOpenMobile(false)} />}
      >
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function AccountMenu() {
  const me = useAdmin()

  const signOut = async () => {
    await authClient.signOut()
    window.location.assign("/sign-in")
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" aria-label="Account" />}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-sm font-medium uppercase">
              {(me.name || me.email).charAt(0)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
              {me.name && (
                <span className="truncate font-medium">{me.name}</span>
              )}
              <span className="truncate text-xs text-muted-foreground">
                {me.email}
              </span>
            </span>
            <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-60">
            <DropdownMenuItem onClick={signOut}>
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
