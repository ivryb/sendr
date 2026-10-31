import { CONTACTS_BATCH_LIMIT, EMAIL_RECIPIENTS_MAX } from "../../shared/model"
import { SES_KEY_POLICY } from "../../shared/ses"

/** The API reference served at /api/v1/docs, written for agents and developers to read. */
export function apiDocs(baseUrl: string) {
  const api = `${baseUrl}/api/v1`
  return `# Sendr API

Sendr sends marketing campaigns and single emails through Amazon SES, and keeps the contact
list they go to. Everything the admin app does is available here.

Base URL: ${api}
Auth: \`Authorization: Bearer <api key>\`. The admin creates keys in Sendr under API. Any other
\`Authorization\` scheme gets \`401\`.
Bodies and responses are JSON. Errors look like \`{ "error": "code", "message": "readable reason" }\`;
validation errors add \`issues\` with the field paths. \`503 cloudflare_limit\` means the Cloudflare
account is on Workers Free and used up a daily D1 limit: every call fails until it resets at 00:00 UTC,
and \`message\` says which limit. Sending campaigns resume on their own after the reset; Workers Paid
($5 a month) lifts the limits.

## Permissions

Each key has one or more. \`GET /me\` returns the caller's.

- \`contacts\`: read and sync contacts.
- \`emails\`: send single emails and read their status.
- \`full\`: everything below, including campaigns, senders and settings. Covers the other two.

An app's backend usually has \`contacts\`, \`emails\` or both; agents get \`full\`. A missing
permission returns \`403 forbidden\`. To make a key without the admin app, run
\`bun run api-key ${baseUrl} --name "<app> backend" --permissions contacts,emails\` in the checkout
this instance deploys from; it prints the key.

## Contacts (contacts permission)

Contacts are keyed by your app's user ID (\`externalId\`), so an email change updates the
same contact. New contacts start subscribed.

- \`PUT /contacts/{externalId}\` with \`{ "email", "firstName"?, "fields"?: { "plan": "pro" }, "unsubscribed"?: true }\`
  adds or updates one contact. \`409 email_taken\` if another contact has the email,
  unless the address only holds an opt-out left when a contact moved or was deleted: the contact
  then takes it over and stays opted out.
  \`unsubscribed: true\` unsubscribes. Updating a contact never resubscribes it.
- \`POST /contacts/batch\` with \`{ "contacts": [{ "externalId"?, "email", ... }] }\`, up to
  ${CONTACTS_BATCH_LIMIT.toLocaleString("en-US")}, adds or updates each in order and returns
  \`results: [{ "externalId"?, "email", "ok", "error"? }]\` in the same order. List each contact once per call. Without \`externalId\` a contact is
  matched by email, which imports a list from another tool; a later call with the user ID attaches
  to the same contact. Mark anyone the old tool had as unsubscribed, bounced or complained with
  \`unsubscribed: true\`.
- \`DELETE /contacts/{externalId}\` removes a contact, for example when the user deletes their account.
  Someone who unsubscribed, bounced or complained is remembered by address, so adding them back
  keeps them opted out.
- \`GET /contacts?q=&status=&limit=50&offset=0\` lists contacts with \`total\` and per-status \`counts\`.
  Statuses: subscribed, unsubscribed, bounced, complained.
- \`POST /contacts/{id}/status\` with \`{ "status": "subscribed" | "unsubscribed" }\` (full permission, by
  Sendr's contact \`id\`). Resubscribe only people who asked. SES keeps addresses that bounced or
  complained on its suppression list, so resubscribing one also needs
  \`aws sesv2 delete-suppressed-destination --email-address <address>\`.

Example:

\`\`\`sh
curl -X PUT ${api}/contacts/user_123 \\
  -H "Authorization: Bearer $SENDR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"email": "ada@example.com", "firstName": "Ada", "fields": {"plan": "pro"}}'
\`\`\`

## Single emails (emails permission)

For receipts, welcome notes and other one-off emails. They go out right away, without the
campaign footer or an unsubscribe link. If anyone on the email bounced or complained before, it
is refused with \`422 suppressed\`, naming them, and nothing is sent.

- \`POST /emails\` with \`{ "from": "<sender address or id>", "to", "subject", "markdown" }\`.
  \`to\` is one address or a list. Optional \`cc\` is a list, and everyone on the email sees
  everyone else. ${EMAIL_RECIPIENTS_MAX} people at most, \`to\` and \`cc\` together.
  Instead of \`markdown\`, send \`html\` (and optionally \`text\`). Optional \`replyTo\`.
  Returns \`{ "email": { "id", "status", "recipients": [{ "email", "field", "status" }], ... } }\`.
  If SES rejects the message itself (for example, an unverified recipient while the SES account
  is in its sandbox), the reply is still 200 with \`status: "failed"\` and the reason in
  \`error\`. \`503 send_failed\` means SES was busy or paused and nothing was sent; retry later.
- Send an \`Idempotency-Key\` header, like \`export-123-ready\`, so a retry can't send the email
  twice: a repeat with the same key returns the first email and sends nothing. Keys are shared by
  everything that uses this instance, so make each one unique to its email. After a
  \`503 send_failed\` nothing was sent, so a retry with the same key does send.
- \`GET /emails/{id}\`: each recipient's status is sent, delivered, bounced or complained, or
  failed when the whole email did. Delivery reports arrive within minutes.

Example:

\`\`\`sh
curl -X POST ${api}/emails \\
  -H "Authorization: Bearer $SENDR_API_KEY" -H "Content-Type: application/json" \\
  -H "Idempotency-Key: welcome-user_123" \\
  -d '{"from": "hello@example.com", "to": "ada@example.com", "subject": "Welcome", "markdown": "Hi Ada, thanks for signing up."}'
\`\`\`

## Campaigns (full permission)

A campaign is a message sent to every subscribed contact. Its \`body\` is written in one of three
\`format\`s:

- \`editor\` (default): a small HTML subset that Sendr lays out for email clients, light and dark.
  Sendr styles these itself, so leave out \`style\` and \`class\`. Other tags are sent as written,
  unstyled, but an edit in the admin app's editor keeps only these.
  - Text: \`h1\`-\`h3\`, \`p\`, \`strong\`, \`em\`, \`u\`, \`s\`, \`a href\`, \`ul\`/\`ol\`/\`li\`, \`blockquote\`, \`hr\`, \`br\`.
  - Image or GIF, as its own block: \`<img src="URL" alt="What it shows" width="1200">\`. Give it a
    \`width\`, its width in pixels: Outlook shows an image without one at full size. It fills the
    600px column at most.
  - Button: \`<a data-button href="URL">Label</a>\`, as its own block.
  - Video card: \`<figure data-media="video" data-src="URL" data-poster="URL" data-title="Title" data-duration="2:14"></figure>\`.
    Email can't play video, so it shows the poster with a play badge and links to \`data-src\`.
  - Audio card: the same with \`data-media="audio"\` and no poster.
  A card needs \`data-media\` and \`data-src\`; the rest are optional. Upload files with
  \`POST /media\` (below) and use their URLs.
- \`html\`: your own HTML, a full document or a fragment, sent as written with the footer added.
- \`text\`: plain text, sent without an HTML part.

Instead of \`format\` and \`body\`, you can send \`markdown\`: Sendr converts it to an \`editor\` body. Merge
tags fill in contact data with a fallback, in any format and inside link URLs:
\`{{first_name|there}}\`, \`{{fields.plan|free}}\`. Starting a campaign sends it to the
first batch (\`firstBatchSize\`, 200 by default), then pauses at \`awaiting_approval\` so a human
can check bounces and complaints. Approve only if fewer than about 5% bounced and 0.1% complained.

Statuses: draft, first_batch, awaiting_approval, sending, sent, cancelled.

- \`GET /campaigns\`, \`GET /campaigns/{id}\` (with delivery \`counts\`). \`GET /campaigns/{id}\`
  also returns \`links\`: \`[{ "url", "clicks" }]\`, most clicked first. While a campaign sends,
  \`progressAt\` is when it last moved on, and \`stalled\` is true once it hasn't for 5 minutes.
  \`live\` is true while its counts may still change: while it sends, and for an hour after its last
  email.
- \`POST /campaigns\` with \`{ "subject"?, "format"?, "body"?, "senderId"?, "firstBatchSize"? }\` (or
  \`markdown\` instead of \`format\` and \`body\`) creates a draft. Without \`senderId\` it uses the first
  verified sender, or the first sender while none is.
- \`PUT /campaigns/{id}\` edits a draft. \`DELETE /campaigns/{id}\` deletes a draft.
- \`GET /campaigns/{id}/screenshot?theme=both\` returns a PNG of the email as a recipient sees it, under
  a mail client's From and Subject. \`theme\` is \`light\`, \`dark\` or \`both\` (the default, side by side).
  Merge tags show their fallbacks. Save it to a file and look at it yourself, then show it to the user:
  embed it in your reply if your interface renders images, or open it with \`open\` or \`xdg-open\`. It runs a browser
  through Cloudflare Browser Run; \`503 browser_unavailable\` means it's busy or at its daily limit
  (on the Workers Free plan, a new browser every 20 seconds and 10 browser-minutes a day), so retry later.
- \`POST /campaigns/{id}/test\` with \`{ "to": "you@example.com" }\` sends one test copy. \`to\` is
  required with an API key.
- \`POST /campaigns/{id}/start\`, \`/approve\`, \`/cancel\`. Start refuses with \`400 not_ready\` when the
  sender isn't ready, or when the list is bigger than what's left of the SES account's 24-hour quota.

Starting a campaign emails real people, and approving it emails everyone. Before either, show the
user the campaign's screenshot, send them a test, and tell them how many subscribed contacts it goes
to. Start or approve only when they say so.

The footer under every campaign (with the sender's postal address) is \`footer\` in settings.

Campaign emails track opens and clicks: links go through the instance, and an invisible image
records the open. \`counts.opened\` and \`counts.clicked\` are recipients who opened or clicked at
least once (a click counts as an open), and each link's \`clicks\` counts each recipient once.
Apple Mail Privacy Protection preloads images, so opens are an overestimate and clicks are the
reliable signal. Text campaigns have no image, so only their clicks count. Test sends and single
emails aren't tracked, and neither are links whose domain comes from a merge tag.

## Media (full permission)

Images, GIFs, video and audio for campaigns, stored by the instance and served from public URLs.

- \`POST /media?name=<file name>\` with the file's bytes as the body (not a form) and its MIME type
  as \`Content-Type\`, one type like \`image/png\`: \`image/*\` (not SVG), \`video/*\` or \`audio/*\`, else \`415\`. Up to 100 MB (\`413\`);
  \`Content-Length\` is required (\`411\`). Optional \`poster=<image media id>\` (a video's or audio's
  cover) and \`duration=<seconds>\`. Returns 201 with \`{ "media": { "id", "kind", "url", "posterUrl",
  "durationSeconds", ... } }\`.
- \`url\` is absolute and public: use it as an \`img src\` or a card's \`data-src\`. For a video, upload
  the poster image first, then the video with \`poster=<the image's id>\`, and use the video's \`url\`
  and \`posterUrl\` as \`data-src\` and \`data-poster\`.

\`\`\`sh
curl -X POST "${api}/media?name=demo.mp4&poster=<image id>" \\
  -H "Authorization: Bearer $SENDR_API_KEY" -H "Content-Type: video/mp4" \\
  --data-binary @demo.mp4
\`\`\`

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

## Updating Sendr

An instance runs the code it was last deployed with, and this page describes that version. To
update it, run \`git pull && bun install && bun run deploy\` in the checkout it deploys from. The
deploy also applies database migrations.
`
}
