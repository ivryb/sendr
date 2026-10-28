import { useSyncExternalStore } from "react"

/** `read()` in the browser and null in the server's render, which hydrates without a mismatch. */
export function useClientValue<T>(read: () => T): T | null {
  return useSyncExternalStore(subscribeNever, read, () => null)
}

function subscribeNever() {
  return () => {}
}
