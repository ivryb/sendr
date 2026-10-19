import { queryOptions } from "@tanstack/react-query"

import type {
  ApiKey,
  Campaign,
  Contact,
  ContactStatus,
  Settings,
} from "../../shared/model"

type Issue = { path: PropertyKey[]; message: string }

/** Any non-2xx response. `message` is safe to show; `issues` holds per-field validation errors. */
export class ApiError extends Error {
  readonly status: number
  readonly issues: Issue[]
  constructor(status: number, message: string, issues: Issue[] = []) {
    super(message)
    this.status = status
    this.issues = issues
  }

  /** The first validation message for a top-level field. */
  fieldError(field: string) {
    return this.issues.find((issue) => issue.path[0] === field)?.message
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers:
      init.body === undefined ? {} : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  })
  const data = await response.json().catch(() => ({}))
  if (response.ok) return data as T
  throw new ApiError(
    response.status,
    data.message ?? fallbackMessage(response.status),
    data.issues
  )
}

function fallbackMessage(status: number) {
  if (status === 401) return "Your session ended. Sign in again."
  if (status === 400) return "Some fields need attention."
  return "Something went wrong. Try again in a moment."
}

export type User = { id: string; email: string; name: string }

export type ContactsQuery = {
  q?: string
  status?: ContactStatus
  limit: number
  offset: number
}

export type ContactsPage = {
  contacts: Contact[]
  total: number
  counts: Partial<Record<ContactStatus, number>>
}

export const queries = {
  setup: queryOptions({
    queryKey: ["setup"],
    queryFn: () => api<{ claimed: boolean }>("/api/setup"),
  }),
  me: queryOptions({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api<{ user: User }>("/api/admin/me")).user
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
  }),
  settings: queryOptions({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/api/admin/settings"),
  }),
  apiKeys: queryOptions({
    queryKey: ["api-keys"],
    queryFn: async () =>
      (await api<{ apiKeys: ApiKey[] }>("/api/admin/api-keys")).apiKeys,
  }),
  contacts: (query: ContactsQuery) =>
    queryOptions({
      queryKey: ["contacts", query],
      queryFn: () => {
        const params = new URLSearchParams({
          limit: String(query.limit),
          offset: String(query.offset),
        })
        if (query.q) params.set("q", query.q)
        if (query.status) params.set("status", query.status)
        return api<ContactsPage>(`/api/admin/contacts?${params}`)
      },
    }),
  campaigns: queryOptions({
    queryKey: ["campaigns"],
    queryFn: async () =>
      (await api<{ campaigns: Campaign[] }>("/api/admin/campaigns")).campaigns,
  }),
  campaign: (id: string) =>
    queryOptions({
      queryKey: ["campaigns", id],
      queryFn: async () =>
        (await api<{ campaign: Campaign }>(`/api/admin/campaigns/${id}`))
          .campaign,
    }),
}

/** Per-status contact counts, for summaries outside the contacts page. */
export const contactCounts = queries.contacts({ limit: 1, offset: 0 })
