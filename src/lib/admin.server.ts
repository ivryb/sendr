import { createContext, redirect, type MiddlewareFunction } from "react-router"

import { getAdmin, type Admin } from "../../worker/auth"

export const adminContext = createContext<Admin>()

/** Sends signed-out visitors to sign-in, which brings them back here afterwards. */
export const requireAdmin: MiddlewareFunction<Response> = async ({
  request,
  url,
  context,
}) => {
  const admin = await getAdmin(request)
  if (!admin) {
    throw redirect(
      `/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`
    )
  }
  context.set(adminContext, admin)
}
