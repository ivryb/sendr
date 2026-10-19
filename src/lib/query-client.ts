import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { ApiError, queries } from "@/lib/api"

declare module "@tanstack/react-query" {
  interface Register {
    /** `silent` mutations show their own error state instead of a toast. */
    mutationMeta: { silent?: boolean }
  }
}

/** One client per browser tab, and one per server render. */
export function createQueryClient() {
  const signOutOnUnauthorized = (error: Error) => {
    if (error instanceof ApiError && error.status === 401) {
      client.setQueryData(queries.me.queryKey, null)
      return true
    }
    return false
  }
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: signOutOnUnauthorized }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (signOutOnUnauthorized(error) || mutation.meta?.silent) return
        toast.error(error.message)
      },
    }),
    defaultOptions: {
      // Server-rendered data counts as fresh, so hydration doesn't refetch it at once.
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 },
    },
  })
  return client
}
