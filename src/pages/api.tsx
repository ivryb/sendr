import type { ReactNode } from "react"
import { ExternalLinkIcon } from "lucide-react"

import type { Route } from "./+types/api"
import { ApiKeys } from "@/components/api-keys"
import { CodeBlock } from "@/components/code-block"
import { CopyField } from "@/components/copy-button"
import { PageHeader } from "@/components/page-header"
import { listApiKeys } from "../../worker/domain/apiKeys"
import { defaultSender } from "../../worker/domain/senders"
import { getSettings } from "../../worker/lib/settings"

export async function loader({ url }: Route.LoaderArgs) {
  const [apiKeys, settings, sender] = await Promise.all([
    listApiKeys(),
    getSettings(),
    defaultSender(),
  ])
  return {
    apiKeys,
    baseUrl: `${settings.publicUrl || url.origin}/api/v1`,
    // Examples use a real sender, so they work when pasted.
    senderEmail: sender?.email ?? "hello@example.com",
  }
}

export default function ApiPage({ loaderData }: Route.ComponentProps) {
  const { apiKeys, baseUrl, senderEmail } = loaderData
  const docsUrl = `${baseUrl}/docs`
  const auth = `-H "Authorization: Bearer $SENDR_API_KEY"`
  const json = `-H "Content-Type: application/json"`

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <PageHeader
        title="API"
        description="Everything in Sendr works through the API. Your app syncs contacts and sends emails, and an agent can run whole campaigns."
      />

      <Section
        title="Keys"
        description="Make one per app or agent, with only the permissions it needs, so you can revoke them separately."
      >
        <ApiKeys apiKeys={apiKeys} />
      </Section>

      <Section
        title="Hand it to an agent"
        description="Create a key with full access, then give your agent this prompt with the key filled in."
      >
        <CodeBlock
          code={`Sendr is the tool I use to email my users. Read its API reference at ${docsUrl} first, then use this API key as a Bearer token: <paste the key here>.`}
          wrap
        />
        <a
          href={docsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium underline underline-offset-4"
        >
          Open the API reference
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </Section>

      <Section
        title="Examples"
        description="Every request goes to this address."
      >
        <CopyField value={baseUrl} />
        <Example title="Add or update a contact">
          {`curl -X PUT ${baseUrl}/contacts/user_123 \\
  ${auth} ${json} \\
  -d '{"email": "ada@example.com", "firstName": "Ada", "fields": {"plan": "pro"}}'`}
        </Example>
        <Example title="Send an email">
          {`curl -X POST ${baseUrl}/emails \\
  ${auth} ${json} \\
  -d '{
    "from": "${senderEmail}",
    "to": "ada@example.com",
    "subject": "Welcome to Acme",
    "markdown": "Hi Ada, thanks for signing up."
  }'`}
        </Example>
        <Example title="Send a campaign">
          {`# Create a draft. It's sent from your first verified sender.
curl -X POST ${baseUrl}/campaigns \\
  ${auth} ${json} \\
  -d '{
    "subject": "October update",
    "markdown": "Hi {{first_name|there}}, here is what shipped."
  }'

# Start it with the id from the reply. Sendr sends the first batch,
# then waits until you approve the rest (POST .../approve).
curl -X POST ${baseUrl}/campaigns/<id>/start \\
  ${auth}`}
        </Example>
      </Section>
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

function Example({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <CodeBlock code={children} />
    </div>
  )
}
