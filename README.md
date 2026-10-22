# Sendr

Cloudflare-native marketing emails. Write a newsletter or product update in Markdown, send it to your users through Amazon SES, and keep everything (contacts, unsubscribes, stats) in your own Cloudflare account.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ivryb/sendr)

- **Costs almost nothing to run.** Sendr is one Cloudflare Worker with a D1 database and a queue. SES charges about $0.10 per 1,000 emails.
- **Safe sending.** Every campaign goes to a small first batch, then pauses so you can check bounces and spam complaints before sending to everyone else.
- **Unsubscribe that works.** Every email carries a visible unsubscribe link and the one-click unsubscribe headers Gmail and Apple Mail show as their own button.
- **Your app stays in charge of users.** Your app pushes contacts to Sendr through a small API, keyed by your own user IDs.
- **No passwords.** Admins sign in with a passkey or a one-time code sent by email.

Sendr is single-tenant: one deployment is one contact list, sent to from one or more of your addresses. Deploy one per project.

## Deploy

### With an agent

Paste this into Claude Code, Codex or another coding agent:

```
Set up Sendr for me: https://sendr.soy/llms.txt
```

The guide there has the agent explain Sendr, check it can reach your Cloudflare and AWS accounts, deploy, set up SES and send you a test. It gives itself an API key, saved in `~/.config/sendr/`, and installs a `sendr` skill so later sessions can run campaigns for you. The guide is [`site/llms.txt`](site/llms.txt).

### By hand

1. Click **Deploy to Cloudflare** above. Cloudflare copies this repo into your GitHub account, creates the D1 database and queue, and asks for `ADMIN_EMAIL`: your email. You sign in with it; nobody else can.
2. Add a custom domain to the Worker (Workers & Pages > sendr > Settings > Domains & Routes), for example `emails.example.com`. Unsubscribe links use it, so pick one you'll keep. Sign in on this domain, not on `workers.dev`: passkeys only work on the domain they were created on, and the first sign-in saves it as the address for unsubscribe links.
3. Open the domain and sign in with your email. Until Sendr can send email itself, sendr.soy delivers your login code (see [Login codes](#login-codes)). Add a passkey when asked.
4. Add a sender in **Senders** (below), then create an API key on the **API** page and push your contacts.

To deploy from a terminal instead, clone the repo and run:

```sh
bun install
bunx wrangler queues create sendr-send
bunx react-router build && bunx wrangler deploy --domain emails.example.com && bunx wrangler d1 migrations apply DB --remote
bunx wrangler secret put ADMIN_EMAIL
```

The first deploy creates the D1 database. The domain stays attached, so later deploys are `bun run deploy`.

## Add a sender

A sender is an address your campaigns come from, like `news@acme.com`, and the email service that sends for it. Amazon SES is the only service so far; it costs about $0.10 per 1,000 emails.

1. In **Senders**, choose **Add sender**. Enter the name and address, then create an AWS access key as the page describes: an IAM user with the policy shown there (SES, plus creating and subscribing to Sendr's own SNS topic).
2. Sendr sets up SES with that key. It starts verifying your domain, and routes delivery, bounce and complaint reports back to Sendr through SNS.
3. Add the DNS records the sender's page lists (DKIM, and a `bounce.` subdomain for SPF). The page checks them on its own.
4. If your SES account is new, request production access from the link on that page. Until AWS approves it, SES only sends to addresses you verified in SES. [Getting SES production access](docs/ses-production-access.md) covers what to write and what to do after a denial.

Each campaign picks its sender in the editor. Instances set up before Senders existed need a sender added this way; their drafts then pick it. To check bounce handling, add `bounce@simulator.amazonses.com` as a contact and send it a campaign; it should show up as bounced.

## API

Everything the admin app does works through the API at `https://emails.example.com/api/v1`, so your app and your agents can use Sendr without the UI. `GET /api/v1/docs` is the full reference, written for agents to read. The **API** page in Sendr has copyable examples and a prompt to hand an agent.

Create keys on the **API** page and tick what each one may do:

- **Contacts**: add, update and remove contacts.
- **Emails**: send single emails, like receipts and welcome notes.
- **Full access**: everything, including campaigns, senders and settings. It covers the other two; give it to agents.

An app's backend usually gets Contacts, Emails or both.

Only the signed-in admin can create or revoke keys in the app. Anyone with Wrangler access to the Cloudflare account can also create one from the checkout, which is how an agent gets its key before anyone signs in:

```sh
bun run api-key https://emails.example.com --name "Acme backend" --permissions contacts,emails
```

It prints the key. Without `--permissions` the key has full access, and `--save` stores it in `~/.config/sendr/<host>.env` for agents on this machine.

### Push contacts from your app

Contacts are keyed by your app's user ID, so an email change updates the same contact.

```sh
# Add or update one contact
curl -X PUT https://emails.example.com/api/v1/contacts/user_123 \
  -H "Authorization: Bearer sk_..." -H "Content-Type: application/json" \
  -d '{ "email": "ann@example.com", "firstName": "Ann", "fields": { "plan": "pro" } }'

# Add or update up to 100 contacts per call
curl -X POST https://emails.example.com/api/v1/contacts/batch \
  -H "Authorization: Bearer sk_..." -H "Content-Type: application/json" \
  -d '{ "contacts": [{ "externalId": "user_123", "email": "ann@example.com" }] }'

# Remove a contact, for example when the user deletes their account
curl -X DELETE https://emails.example.com/api/v1/contacts/user_123 -H "Authorization: Bearer sk_..."
```

- New contacts start subscribed. Pass `"unsubscribed": true` to import someone who already opted out.
- Updating a contact never resubscribes it. Only the recipient (from the unsubscribe page) or an admin can.
- Deleting someone who unsubscribed, bounced or complained keeps their address on file, so adding them back keeps them opted out.
- An email that already belongs to another user ID is rejected with `409`. Every call is safe to repeat, so rerunning a full backfill repairs any drift.

### Send single emails

```sh
curl -X POST https://emails.example.com/api/v1/emails \
  -H "Authorization: Bearer sk_..." -H "Content-Type: application/json" \
  -d '{ "from": "hello@example.com", "to": "ann@example.com", "subject": "Welcome", "markdown": "Thanks for signing up." }'
```

`from` is one of your verified senders. Single emails go out right away, without the campaign footer or an unsubscribe link. Addresses that bounced or reported spam before are refused. `GET /api/v1/emails/{id}` shows whether it was delivered.

## Writing campaigns

Campaigns are Markdown. Merge tags fill in contact data with a fallback: `Hey {{first_name|there}}`, `{{fields.plan|free}}`. The preview in the editor is rendered by the same code that sends the email. The footer under the message is shared by every campaign; include your postal address there, since anti-spam laws require one.

Starting a campaign sends it to the first batch (200 contacts by default) and pauses. Check delivered, bounced and complained counts, then approve sending to everyone else. As a rule of thumb, stop if more than about 5% bounce or 0.1% complain.

The campaign page also shows how many recipients opened and clicked, and which links they clicked. Links in campaign emails go through your Sendr domain to count clicks, and an invisible image counts opens. Apple Mail preloads images, so opens run high; clicks are the reliable signal.

## Configuration

| Name | Kind | Purpose |
| --- | --- | --- |
| `ADMIN_EMAIL` | secret | The admin's email. To recover access or add a new owner, change it and sign in with the new address. Earlier admins keep their access. |
| `LOGIN_CODE_RELAY_URL` | var | Where login codes go when the instance can't send them itself. Empty turns it off. |

Session and link-signing secrets, and the webhook secret, are generated on first run and stored in D1. Senders' AWS keys are stored there too, inside your Cloudflare account.

### Login codes

Admins sign in with a passkey or a 6-digit code sent to their email. Once a sender is verified, codes come from the first one. Before that, or if that send fails (for example while SES is still in its sandbox), your instance asks sendr.soy to email the code from `hello@sendr.soy`, so a fresh deploy's first sign-in works. sendr.soy receives only the admin's address and the code, and sends a fixed message. To keep everything inside your account, set `LOGIN_CODE_RELAY_URL` to `""` in your copy's `wrangler.jsonc` once your own sending works (a value set in the dashboard is reset by the next deploy).

## Development

```sh
bun install
bun run db:migrate:local
bun run dev          # admin app and Worker on one dev server
bun run test         # behavior tests in the Workers runtime
bun run typecheck
```

Copy `.dev.vars.example` to `.dev.vars`. It sets `EMAIL_PROVIDER=memory` and an empty `LOGIN_CODE_RELAY_URL`, so emails, including login codes, are printed to the dev server log instead of being sent. After changing `worker/db/schema.ts`, run `bun run db:generate` to create a migration.

The Worker lives in `worker/` (Hono routes, domain logic, providers). The admin app in `src/` is a React Router app: each page in `src/pages/` loads its data on the server in a `loader` and saves through the same `/api/v1` API that apps and agents use (`worker/routes/api.ts`). Its routes are listed in `src/routes.ts`. Code both use (the domain model and the email renderer) lives in `shared/`. `site/` is the sendr.soy Worker, run by the Sendr project rather than by each instance. A new email service needs an `EmailProvider` adapter in `worker/email/`, plus its setup and checks in `worker/domain/senders.ts`.

## License

MIT
