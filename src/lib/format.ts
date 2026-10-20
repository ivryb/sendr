import { useTimeZone } from "@/root"

// A fixed locale and the admin's time zone, so server-rendered text matches the browser's.
const LOCALE = "en-US"
const numberFormat = new Intl.NumberFormat(LOCALE)

export function formatNumber(value: number) {
  return numberFormat.format(value)
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    maximumFractionDigits: value > 0 && value < 0.01 ? 2 : 1,
  }).format(value)
}

/** Dates in the admin's time zone, which the server renders with too. */
export function useDates() {
  const timeZone = useTimeZone()
  /** "Oct 19", with the year only when it isn't this year. */
  const formatDate = (value: string | Date) => {
    const date = new Date(value)
    return date.toLocaleDateString(LOCALE, {
      timeZone,
      month: "short",
      day: "numeric",
      year:
        date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    })
  }
  const formatDateTime = (value: string | Date) =>
    `${formatDate(value)}, ${new Date(value).toLocaleTimeString(LOCALE, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    })}`
  return { formatDate, formatDateTime }
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${formatNumber(count)} ${count === 1 ? one : many}`
}
