# Sendr

Cloudflare-native marketing emails. Write a newsletter or product update in Markdown, send it to your users through Amazon SES, and keep everything (contacts, unsubscribes, stats) in your own Cloudflare account.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ivryb/sendr)

- **Costs almost nothing to run.** Sendr is one Cloudflare Worker with a D1 database and a queue. SES charges about $0.10 per 1,000 emails.
- **Safe sending.** Every campaign goes to a small first batch, then pauses so you can check bounces and spam complaints before sending to everyone else.
- **Unsubscribe that works.** Every email carries a visible unsubscribe link and the one-click unsubscribe headers Gmail and Apple Mail show as their own button.
- **Your app stays in charge of users.** Your app pushes contacts to Sendr through a small API, keyed by your own user IDs.
- **No passwords.** Admins sign in with a passkey or a one-time code sent by email.

Sendr is single-tenant: one deployment is one sender and one contact list. Deploy one per project.

## Deploy

1. Click **Deploy to Cloudflare** above. Cloudflare copies this repo into your GitHub account, creates the D1 database and queue, and asks for three secrets:
   - `SETUP_CODE`: any phrase you choose. You enter it once to claim the instance.
   - `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`: an SES sending key. Put a placeholder for now; step 4 creates the real one.
2. Add a custom domain to the Worker (Workers & Pages > sendr > Settings > Domains & Routes), for example `emails.example.com`. Unsubscribe links use it, so pick one you'll keep.
3. Open the domain, enter your setup code, and add a passkey. In **Settings**, fill in the sender name and address, the footer (include your postal address: anti-spam laws require it), and the public URL.
4. Connect SES (below), then create an API key in **Settings** and push your contacts.

To deploy by hand instead: clone the repo, `bun install`, `bunx wrangler secret put SETUP_CODE` (and the AWS keys), then `bun run deploy`.

## Connect Amazon SES

1. In SES, verify your sending domain (Easy DKIM) in the region you'll use, and set a custom MAIL FROM domain so SPF aligns.
2. Request production access. New SES accounts can only send to verified addresses until AWS approves it.
3. With admin AWS credentials, run:

   ```sh
   scripts/setup-ses.sh https://emails.example.com <webhook secret from Settings> us-east-1
   ```

   It creates the `sendr` configuration set, routes delivery, bounce and complaint events to Sendr through EventBridge, and creates an IAM user that can only send email. Store the access key it prints as the Worker's `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` secrets.
4. Send a test from any campaign to check the setup. To check bounce handling, add `bounce@simulator.amazonses.com` as a contact and send it a campaign; it should show up as bounced.

## Push contacts from your app

Create an API key in **Settings**. Contacts are keyed by your app's user ID, so an email change updates the same contact.

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
- The API can unsubscribe a contact but never resubscribes one. Only the recipient (from the unsubscribe page) or an admin can.
- An email that already belongs to another user ID is rejected with `409`. Every call is safe to repeat, so rerunning a full backfill repairs any drift.

## Writing campaigns

Campaigns are Markdown. Merge tags fill in contact data with a fallback: `Hey {{first_name|there}}`, `{{fields.plan|free}}`. The preview in the editor is rendered by the same code that sends the email.

Starting a campaign sends it to the first batch (200 contacts by default) and pauses. Check delivered, bounced and complained counts, then approve sending to everyone else. As a rule of thumb, stop if more than about 5% bounce or 0.1% complain.

## Configuration

| Name | Kind | Purpose |
| --- | --- | --- |
| `SETUP_CODE` | secret | Claims the instance. Each code works once; set a new one to recover access if you lose your passkeys and email. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | secrets | SES sending credentials. |
| `AWS_REGION` | var | SES region, `us-east-1` by default. |
| `SES_CONFIGURATION_SET` | var | Configuration set that publishes events, `sendr` by default. |
| `SES_MAX_SENDS_PER_SECOND` | var | Your SES send rate. Sendr paces sends to stay under it. |
| `EMAIL_PROVIDER` | var | Provider for campaigns: `ses`. |
| `AUTH_EMAIL_PROVIDER` | var | Provider for login codes: `ses`, or `cloudflare` to use Cloudflare Email Sending once your domain is onboarded to it. |

Session and link-signing secrets, and the webhook secret, are generated on first run and stored in D1.

## Development

```sh
bun install
bun run db:migrate:local
bun run dev          # admin app and Worker on one Vite dev server
bun run test         # behavior tests in the Workers runtime
bun run typecheck
```

Local `.dev.vars` can set `EMAIL_PROVIDER=memory` and `AUTH_EMAIL_PROVIDER=memory`: emails, including login codes, are printed to the dev server log instead of being sent. After changing `worker/db/schema.ts`, run `bun run db:generate` to create a migration.

The Worker lives in `worker/` (Hono routes, domain logic, providers), the admin app in `src/`, and code both use (the domain model and the email renderer) in `shared/`. A new email service only needs an `EmailProvider` adapter in `worker/email/`.

## License

MIT
