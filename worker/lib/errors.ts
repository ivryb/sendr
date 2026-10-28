/** A request the API refuses for a reason the caller can fix; `message` is safe to show. */
export class DomainError extends Error {
  readonly code: string
  readonly status: 400 | 403 | 404 | 409 | 411 | 413 | 415 | 422 | 503
  constructor(code: string, status: DomainError["status"], message: string) {
    super(message)
    this.code = code
    this.status = status
  }
}
