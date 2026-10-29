import { ArrowLeftIcon, CheckIcon } from "lucide-react"
import { Link } from "react-router"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import type { Sender } from "../../shared/model"

/** "Ada from Acme <news@acme.com>", for showing a sender in lists and pickers. */
export function senderLabel(sender: Pick<Sender, "name" | "email">) {
  return sender.name ? `${sender.name} <${sender.email}>` : sender.email
}

export const SENDER_SERVICES: Record<Sender["provider"], string> = {
  ses: "Amazon SES",
}

/** Ready once the domain is verified and the account can email anyone. */
function senderStatus(sender: Pick<Sender, "verified" | "production">) {
  if (!sender.verified) return { label: "Waiting for DNS", dot: "bg-amber-500" }
  if (!sender.production) return { label: "Sandbox", dot: "bg-amber-500" }
  return { label: "Ready", dot: "bg-emerald-500" }
}

export function SenderStatusBadge({ sender }: { sender: Sender }) {
  const status = senderStatus(sender)
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", status.dot)} />
      {status.label}
    </Badge>
  )
}

export function BackToSenders() {
  return (
    <Link
      to="/senders"
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" />
      Senders
    </Link>
  )
}

const STEPS = ["Service", "Connect", "Verify"]

/** Where adding a sender is: choosing a service, connecting it, verifying the domain. */
export function SetupSteps({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          {index > 0 && <span className="h-px w-6 bg-border" />}
          <span
            className={cn(
              "grid size-6 place-items-center rounded-full border text-xs tabular-nums",
              index < current &&
                "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
              index === current &&
                "border-transparent bg-primary text-primary-foreground"
            )}
          >
            {index < current ? <CheckIcon className="size-3" /> : index + 1}
          </span>
          <span
            className={cn(
              index === current ? "font-medium" : "text-muted-foreground"
            )}
          >
            {step}
          </span>
        </li>
      ))}
    </ol>
  )
}
