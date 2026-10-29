import { createContext, data, redirect, type MiddlewareFunction } from "react-router"

import { getAdmin, type Admin } from "../../worker/auth"
import { DomainError } from "../../worker/lib/errors"

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

/** For loaders: a record the domain can't find shows the 404 page instead of an error. */
export function orNotFound<T>(load: Promise<T>) {
  return load.catch((error: unknown) => {
    if (error instanceof DomainError && error.status === 404) throw data(null, { status: 404 })
    throw error
  })
}
