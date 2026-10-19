import { timeZone } from "@/lib/ssr"

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

/** "Oct 19", with the year only when it isn't this year. */
export function formatDate(value: string | Date) {
  const date = new Date(value)
  return date.toLocaleDateString(LOCALE, {
    timeZone: timeZone(),
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })
}

export function formatDateTime(value: string | Date) {
  return `${formatDate(value)}, ${new Date(value).toLocaleTimeString(LOCALE, {
    timeZone: timeZone(),
    hour: "numeric",
    minute: "2-digit",
  })}`
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${formatNumber(count)} ${count === 1 ? one : many}`
}
