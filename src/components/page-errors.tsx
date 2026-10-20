import { Outlet } from "react-router"

import { RouteError } from "@/components/route-error"

/** Keeps the sidebar on screen when a page fails to load. */
export default function PageErrors() {
  return <Outlet />
}

export function ErrorBoundary() {
  return <RouteError />
}
