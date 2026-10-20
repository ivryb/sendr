import { AtSignIcon, PlusIcon } from "lucide-react"
import { Link } from "react-router"

import type { Route } from "./+types/senders"
import { PageHeader } from "@/components/page-header"
import { SENDER_SERVICES, SenderStatusBadge } from "@/components/senders"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { listSenders } from "../../worker/domain/senders"

export async function loader() {
  return { senders: await listSenders() }
}

export default function SendersPage({ loaderData }: Route.ComponentProps) {
  const { senders } = loaderData
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Senders"
        description="The addresses your campaigns come from. The first ready one also sends login codes."
        actions={
          senders.length > 0 && (
            <Button nativeButton={false} render={<Link to="/senders/new" />}>
              <PlusIcon />
              Add sender
            </Button>
          )
        }
      />
      {senders.length ? (
        <ul className="divide-y overflow-hidden rounded-xl ring-1 ring-foreground/10">
          {senders.map((sender) => (
            <li key={sender.id}>
              <Link
                to={`/senders/${sender.id}`}
                className="flex items-center gap-4 bg-card px-5 py-4 transition-colors hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">
                    {sender.name || sender.email}
                    {sender.name && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        &lt;{sender.email}&gt;
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {SENDER_SERVICES[sender.provider]}, {sender.region}
                  </span>
                </div>
                <SenderStatusBadge sender={sender} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AtSignIcon />
            </EmptyMedia>
            <EmptyTitle>Add your first sender</EmptyTitle>
            <EmptyDescription>
              Connect an email service and verify your domain. Sendr walks you
              through it.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link to="/senders/new" />}>
              <PlusIcon />
              Add sender
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </div>
  )
}
