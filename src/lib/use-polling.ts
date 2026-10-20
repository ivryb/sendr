import { useEffect } from "react"
import { useRevalidator } from "react-router"

/** Reloads the page's data every `interval` ms while the tab is visible; `false` stops. */
export function usePolling(interval: number | false) {
  const { revalidate } = useRevalidator()
  useEffect(() => {
    if (interval === false) return
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") revalidate()
    }, interval)
    return () => clearInterval(timer)
  }, [interval, revalidate])
}
