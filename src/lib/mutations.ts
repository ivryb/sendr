import {
  MutationCache,
  QueryClient,
  useMutation,
  type UseMutationOptions,
} from "@tanstack/react-query"
import { useRevalidator } from "react-router"
import { toast } from "sonner"

import { ApiError } from "@/lib/api"

declare module "@tanstack/react-query" {
  interface Register {
    /** `silent` mutations show their own error state instead of a toast. */
    mutationMeta: { silent?: boolean }
  }
}

/** Changes go through the admin API; pages read their data from route loaders. */
export function createQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (error instanceof ApiError && error.status === 401) {
          const here = window.location.pathname + window.location.search
          window.location.assign(`/sign-in?next=${encodeURIComponent(here)}`)
          return
        }
        if (!mutation.meta?.silent) toast.error(error.message)
      },
    }),
  })
}

/** A change through the admin API, after which the page's loaders run again. */
export function useChange<TData, TVariables = void>(
  options: UseMutationOptions<TData, Error, TVariables>
) {
  const { revalidate } = useRevalidator()
  return useMutation({
    ...options,
    onSuccess: async (...args) => {
      await revalidate()
      await options.onSuccess?.(...args)
    },
  })
}
