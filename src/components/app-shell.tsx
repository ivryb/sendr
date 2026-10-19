import { useQuery } from "@tanstack/react-query"
import { KeyRoundIcon, LogOutIcon } from "lucide-react"
import { Link, NavLink, Outlet } from "react-router"
import { cn } from "cn"

import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { queries } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { useAddPasskey } from "@/lib/passkeys"

const NAV = [
  { to: "/campaigns", label: "Campaigns" },
  { to: "/contacts", label: "Contacts" },
  { to: "/settings", label: "Settings" },
]

export function AppShell() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Link to="/campaigns" aria-label="Sendr home">
            <Logo nameClassName="hidden sm:inline" />
          </Link>
          <nav className="flex flex-1 items-center gap-0.5">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                    isActive && "bg-muted font-medium text-foreground"
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <AccountMenu />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Account"
          />
        }
      >
        <span className="grid size-8 place-items-center rounded-full bg-muted text-sm font-medium uppercase">
          {(me.name || me.email).charAt(0)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
            <span className="font-medium text-foreground">{me.name}</span>
            <span className="truncate font-normal">{me.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
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
  )
}
