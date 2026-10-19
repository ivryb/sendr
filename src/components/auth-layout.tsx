import type { ReactNode } from "react"

import { Logo } from "@/components/logo"

/** The centered, single-column frame for setup and sign-in. */
export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string
  description: ReactNode
  children: ReactNode
}) {
  return (
    <main className="flex min-h-svh flex-col items-center px-5 pt-[14vh] pb-10">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <Logo />
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm/relaxed text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </main>
  )
}
