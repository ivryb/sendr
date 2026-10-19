import { ArrowLeftIcon } from "lucide-react"
import { Link } from "react-router"

export function BackToCampaigns() {
  return (
    <Link
      to="/campaigns"
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" />
      Campaigns
    </Link>
  )
}
