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
  const data: unknown = await response.json().catch(() => ({}))
  if (response.ok) return data as T
  const { message, issues } = data as { message?: string; issues?: Issue[] }
  throw new ApiError(
    response.status,
    message ?? fallbackMessage(response.status),
    issues
  )
}

function fallbackMessage(status: number) {
  if (status === 401) return "Your session ended. Sign in again."
  if (status === 400) return "Some fields need attention."
  return "Something went wrong. Try again in a moment."
}
