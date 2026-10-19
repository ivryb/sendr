/**
 * Request-scoped values the Worker provides while it renders a page on the server
 * (see worker/ssr.ts). In the browser there is no context and the browser's own apply.
 */
export type SsrContext = { fetch: typeof fetch; timeZone: string }

declare global {
  var __sendrSsr: (() => SsrContext | undefined) | undefined
}

const context = () => globalThis.__sendrSsr?.()

export const appFetch: typeof fetch = (input, init) =>
  (context()?.fetch ?? fetch)(input, init)

export const timeZone = () =>
  context()?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone

/** Lets the server render dates in the admin's time zone on the next page load. */
export function rememberTimeZone() {
  document.cookie = `tz=${encodeURIComponent(timeZone())}; path=/; max-age=31536000; samesite=lax`
}
