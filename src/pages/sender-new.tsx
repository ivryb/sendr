import { useState, type FormEvent } from "react"
import { useMutation } from "@tanstack/react-query"
import { CheckIcon, ExternalLinkIcon } from "lucide-react"
import { useNavigate } from "react-router"
import type { z } from "zod"

import { CodeBlock } from "@/components/code-block"
import { PageHeader } from "@/components/page-header"
import { BackToSenders, SetupSteps } from "@/components/senders"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { api, ApiError } from "@/lib/api"
import type { Sender } from "../../shared/model"
import { SES_KEY_POLICY } from "../../shared/ses"
import type { senderInput } from "../../worker/domain/senders"

const REGIONS = [
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "us-east-2", label: "US East (Ohio)" },
  { value: "us-west-2", label: "US West (Oregon)" },
  { value: "ca-central-1", label: "Canada (Central)" },
  { value: "eu-west-1", label: "Europe (Ireland)" },
  { value: "eu-west-2", label: "Europe (London)" },
  { value: "eu-central-1", label: "Europe (Frankfurt)" },
  { value: "eu-north-1", label: "Europe (Stockholm)" },
  { value: "ap-south-1", label: "Asia Pacific (Mumbai)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { value: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
  { value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
  { value: "sa-east-1", label: "South America (São Paulo)" },
]

export default function NewSenderPage() {
  const [step, setStep] = useState<"service" | "connect">("service")
  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-4">
        <BackToSenders />
        <PageHeader title="Add sender" />
        <SetupSteps current={step === "service" ? 0 : 1} />
      </div>
      {step === "service" ? (
        <ServiceStep onNext={() => setStep("connect")} />
      ) : (
        <ConnectStep />
      )}
    </div>
  )
}

function ServiceStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-xl bg-card p-4 ring-2 ring-primary">
          <span className="flex items-center justify-between font-medium">
            Amazon SES
            <CheckIcon className="size-4" />
          </span>
          <span className="text-sm text-muted-foreground">
            About $0.10 per 1,000 emails. Needs an AWS account.
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-dashed p-4 text-muted-foreground">
          <span className="font-medium">More services</span>
          <span className="text-sm">Coming later.</span>
        </div>
      </div>
      <Button onClick={onNext} className="w-fit">
        Continue
      </Button>
    </div>
  )
}

type Values = z.input<typeof senderInput>

function ConnectStep() {
  const navigate = useNavigate()
  const [region, setRegion] = useState("us-east-1")
  const connect = useMutation({
    mutationFn: (values: Values) =>
      api<{ sender: Sender }>("/api/v1/senders", { body: values }),
    onSuccess: ({ sender }) => navigate(`/senders/${sender.id}`),
    meta: { silent: true },
  })
  const error = connect.error instanceof ApiError ? connect.error : null
  const fieldError = (name: keyof Values) => error?.fieldError(name)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? "").trim()
    connect.mutate({
      name: text("name"),
      email: text("email"),
      replyTo: text("replyTo"),
      region,
      accessKeyId: text("accessKeyId"),
      secretAccessKey: text("secretAccessKey"),
    })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <SectionTitle
          title="From"
          description="How your emails look in the inbox."
        />
        <FieldGroup className="gap-5">
          <TextField
            name="name"
            label="Name"
            placeholder="Ada from Acme"
            error={fieldError("name")}
          />
          <TextField
            name="email"
            label="Email"
            type="email"
            placeholder="news@acme.com"
            description="Sendr verifies its domain with SES in the next step."
            error={fieldError("email")}
          />
          <TextField
            name="replyTo"
            label="Reply-to"
            type="email"
            placeholder="ada@acme.com"
            description="Optional. Where replies go, if not the address above."
            error={fieldError("replyTo")}
          />
        </FieldGroup>
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle
          title="AWS access key"
          description="Sendr uses it to set up SES for you and to send. It stays in your Cloudflare account."
        />
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm/relaxed text-muted-foreground marker:text-muted-foreground/70">
          <li>
            In the AWS console, open{" "}
            <a
              href="https://console.aws.amazon.com/iam/home#/users/create"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
            >
              IAM, Create user
              <ExternalLinkIcon className="size-3" />
            </a>{" "}
            and name it <code className="font-mono text-foreground">sendr</code>
            .
          </li>
          <li>
            Choose{" "}
            <span className="text-foreground">Attach policies directly</span>,
            create a policy with this JSON, and attach it.
            <CodeBlock code={SES_KEY_POLICY} className="mt-2" />
          </li>
          <li>
            Open the user, choose{" "}
            <span className="text-foreground">Create access key</span>, pick{" "}
            <span className="text-foreground">
              Application running outside AWS
            </span>
            , and paste the key here.
          </li>
        </ol>
        <FieldGroup className="gap-5">
          <TextField
            name="accessKeyId"
            label="Access key ID"
            placeholder="AKIA…"
            mono
            error={fieldError("accessKeyId")}
          />
          <TextField
            name="secretAccessKey"
            label="Secret access key"
            type="password"
            mono
            error={fieldError("secretAccessKey")}
          />
          <Field>
            <FieldLabel>Region</FieldLabel>
            <Select
              items={REGIONS}
              value={region}
              onValueChange={(value) => value && setRegion(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Pick one near your audience. SES approves production access per
              region.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </section>

      {error && !error.issues.length && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      <Button type="submit" disabled={connect.isPending} className="w-fit">
        {connect.isPending && <Spinner />}
        {connect.isPending ? "Setting up SES" : "Connect"}
      </Button>
    </form>
  )
}

function TextField({
  name,
  label,
  type = "text",
  placeholder,
  description,
  mono = false,
  error,
}: {
  name: string
  label: string
  type?: "text" | "email" | "password"
  placeholder?: string
  description?: string
  mono?: boolean
  error?: string
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={mono ? "font-mono" : undefined}
      />
      {error && <FieldError>{error}</FieldError>}
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
}

function SectionTitle({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
