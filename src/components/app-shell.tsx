import { useQuery } from "@tanstack/react-query"
import {
  ChevronsUpDownIcon,
  KeyRoundIcon,
  LogOutIcon,
  MailIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react"
import { Link, NavLink, Outlet, useMatch } from "react-router"

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
import { queries } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { useAddPasskey } from "@/lib/passkeys"

const NAV = [
  { to: "/campaigns", label: "Campaigns", icon: MailIcon },
  { to: "/contacts", label: "Contacts", icon: UsersIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
]

export function AppShell() {
  return (
    <SidebarProvider>
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
      <SidebarInset>
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
  const me = useQuery(queries.me).data
  const addPasskey = useAddPasskey()
  if (!me) return null

  const signOut = async () => {
    await authClient.signOut()
    // A full reload drops every cached response from the signed-in session.
    window.location.assign("/")
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
            <DropdownMenuItem onClick={() => addPasskey.mutate()}>
              <KeyRoundIcon />
              Add passkey
            </DropdownMenuItem>
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
