import { SES_KEY_POLICY } from "../../shared/ses"

/** The API reference served at /api/v1/docs, written for agents and developers to read. */
export function apiDocs(baseUrl: string) {
  const api = `${baseUrl}/api/v1`
  return `# Sendr API

Sendr sends marketing campaigns and single emails through Amazon SES, and keeps the contact
list they go to. Everything the admin app does is available here.

Base URL: ${api}
Auth: \`Authorization: Bearer <api key>\`. The admin creates keys in Sendr under API.
Bodies and responses are JSON. Errors look like \`{ "error": "code", "message": "readable reason" }\`;
validation errors add \`issues\` with the field paths.

## Permissions

Each key has one or more. \`GET /me\` returns the caller's.

- \`contacts\`: read and sync contacts.
- \`emails\`: send single emails and read their status.
- \`full\`: everything below, including campaigns, senders and settings. Covers the other two.

An app's backend usually has \`contacts\`, \`emails\` or both; agents get \`full\`. A missing
permission returns \`403 forbidden\`.

## Contacts (contacts permission)

Contacts are keyed by your app's user ID (\`externalId\`), so an email change updates the
same contact. New contacts start subscribed.

- \`PUT /contacts/{externalId}\` with \`{ "email", "firstName"?, "fields"?: { "plan": "pro" }, "unsubscribed"?: true }\`
  adds or updates one contact. \`409 email_taken\` if the email belongs to another user ID.
  \`unsubscribed: true\` unsubscribes. Updating a contact never resubscribes it.
- \`POST /contacts/batch\` with \`{ "contacts": [{ "externalId", "email", ... }] }\`, up to 100.
- \`DELETE /contacts/{externalId}\` removes a contact, for example when the user deletes their account.
  Someone who unsubscribed, bounced or complained is remembered by address, so adding them back
  keeps them opted out.
- \`GET /contacts?q=&status=&limit=50&offset=0\` lists contacts with \`total\` and per-status \`counts\`.
  Statuses: subscribed, unsubscribed, bounced, complained.
- \`POST /contacts/{id}/status\` with \`{ "status": "subscribed" | "unsubscribed" }\` (full permission, by
  Sendr's contact \`id\`). Resubscribe only people who asked.

Example:

\`\`\`sh
curl -X PUT ${api}/contacts/user_123 \\
  -H "Authorization: Bearer $SENDR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"email": "ada@example.com", "firstName": "Ada", "fields": {"plan": "pro"}}'
\`\`\`

## Single emails (emails permission)

For receipts, welcome notes and other one-off emails. They go out right away, without the
campaign footer or an unsubscribe link. Addresses that bounced or complained before are
refused with \`422 suppressed\`.

- \`POST /emails\` with \`{ "from": "<sender address or id>", "to", "subject", "markdown" }\`.
  Instead of \`markdown\`, send \`html\` (and optionally \`text\`). Optional \`replyTo\`.
  Returns \`{ "email": { "id", "status", ... } }\`. If SES rejects the message itself (for example,
  an unverified recipient while the SES account is in its sandbox), the reply is still 200 with
  \`status: "failed"\` and the reason in \`error\`. \`503 send_failed\` means SES was busy or paused
  and nothing was sent; retry later.
- \`GET /emails/{id}\`: status is sent, delivered, bounced, complained or failed. Delivery
  reports arrive within minutes.

Example:

\`\`\`sh
curl -X POST ${api}/emails \\
  -H "Authorization: Bearer $SENDR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"from": "hello@example.com", "to": "ada@example.com", "subject": "Welcome", "markdown": "Hi Ada, thanks for signing up."}'
\`\`\`

## Campaigns (full permission)

A campaign is Markdown sent to every subscribed contact. Merge tags fill in contact data with a
fallback: \`{{first_name|there}}\`, \`{{fields.plan|free}}\`. Starting a campaign sends it to the
first batch (\`firstBatchSize\`, 200 by default), then pauses at \`awaiting_approval\` so a human
can check bounces and complaints. Approve only if fewer than about 5% bounced and 0.1% complained.

Statuses: draft, first_batch, awaiting_approval, sending, sent, cancelled.

- \`GET /campaigns\`, \`GET /campaigns/{id}\` (with delivery \`counts\`)
- \`POST /campaigns\` with \`{ "subject"?, "markdown"?, "senderId"?, "firstBatchSize"? }\` creates a
  draft. Without \`senderId\` it uses the first verified sender.
- \`PUT /campaigns/{id}\` edits a draft. \`DELETE /campaigns/{id}\` deletes a draft.
- \`POST /campaigns/{id}/test\` with \`{ "to": "you@example.com" }\` sends one test copy. \`to\` is
  required with an API key.
- \`POST /campaigns/{id}/start\`, \`/approve\`, \`/cancel\`.

The footer under every campaign (with the sender's postal address) is \`footer\` in settings.

## Senders (full permission)

A sender is a From address and the Amazon SES account that sends for it.

- \`GET /senders\`
- \`POST /senders\` with \`{ "name", "email", "replyTo"?, "region", "accessKeyId", "secretAccessKey" }\`
  sets up SES: domain verification and delivery reports. It needs \`publicUrl\` in settings,
  since SES reports back to it. Give the key its own IAM user with this policy:

\`\`\`json
${SES_KEY_POLICY}
\`\`\`

- \`GET /senders/{id}\` checks it live: the DNS \`records\` to add, whether it's \`verified\`, and
  whether the SES account has \`production\` access. Add every record, then check again; SES
  usually verifies the domain within an hour.
- \`PATCH /senders/{id}\` with \`{ "name"?, "replyTo"? }\`. \`DELETE /senders/{id}\`.

A new SES account is in the sandbox: it sends only to addresses verified in SES, and campaigns
can't reach your contacts until AWS grants production access. How to request it, and what to do
after a denial: https://github.com/ivryb/sendr/blob/main/docs/ses-production-access.md

## Settings (full permission)

- \`GET /settings\`, \`PUT /settings\` with \`{ "footer"?, "publicUrl"? }\`. \`footer\` is Markdown.
  \`publicUrl\` is this instance's https address, used in unsubscribe links and by SES delivery
  reports. The admin's first sign-in fills it in; set it yourself if you set up Sendr before that.
`
}
