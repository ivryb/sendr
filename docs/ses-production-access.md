# Getting SES production access

New SES accounts start in the sandbox: at most 200 emails a day, only to addresses you verified in SES. Sendr can't send campaigns until AWS grants production access. The request is one form, reviewed by AWS's abuse team, and a vague first request is the usual reason for a denial. This page covers what to send and what to do if AWS says no.

## Before you request

- Finish the sender in Sendr first: the domain verified, DKIM and the `bounce.` subdomain records in place, and delivery reports connected. Reviewers check that you can handle bounces and complaints, and Sendr's setup is your evidence.
- Add a DMARC record for your domain, even `v=DMARC1; p=none`.
- Make sure your website is live and explains what you do, with a privacy policy and terms.
- Request production access in the region your sender uses. AWS approves each region separately.

## What to write

Use the **Request production access** form in the SES console (the sender page in Sendr links to it). AWS asks for specifics, and a generic "please move us out of the sandbox" gets denied. Cover each of these:

- **Who you are.** What your product does, with its URL.
- **What you send.** Name each email type, for example a monthly product update, sign-in codes, receipts. If most of your mail is triggered by users, say so; transactional mail draws less scrutiny than marketing.
- **Where the addresses come from.** People who signed up for your product themselves. Say plainly that you never buy, rent, or scrape lists.
- **Volume.** Emails per day and per week, and peak emails per second. Realistic numbers beat big ones.
- **A sample email.** Its subject, a few lines of body, and the address it comes from.
- **Bounces and complaints.** Every sender in Sendr sends through a configuration set that reports deliveries, bounces and complaints to Sendr through SNS. Addresses that bounce or complain are never emailed again. Campaigns go to a first batch and pause, so you can check bounce and complaint rates before sending to everyone.
- **Unsubscribe.** Every campaign carries a visible unsubscribe link and RFC 8058 one-click `List-Unsubscribe` headers. Opt-outs take effect immediately, and imported contacts who opted out elsewhere stay opted out.
- **Earlier denials.** If AWS denied you before, give the case ID and what you changed.

Things that look bad to a reviewer:

- Describing a migration: "we're moving our list of 5,000 from another provider" reads like a list arriving on a new account. Describe your users and how they signed up instead.
- Choosing **Marketing** when most of your mail is transactional.
- Mentioning testing or learning as the purpose.
- A brand-new AWS account with no billing history. An older account helps; if yours is new, be extra specific.

## If AWS denies it

Denials arrive as a status change, often with no explanation in the case. Check with `aws sesv2 get-account --region <region>`: `Details.ReviewDetails.Status` is `DENIED` and gives the case ID.

- Reply on the denied case in the AWS Support Center rather than filing new requests. Ask for a secondary review, and paste an improved request with everything above. AWS can reconsider an existing case.
- While that case is open, a new request through the SES form or API fails with a `ConflictException`. Wait for the answer on the case.
- Don't resubmit the same text repeatedly. Repeated weak requests can get an account permanently refused.

AWS usually answers within a day. Once approved, `ProductionAccessEnabled` turns true, and the sender's page in Sendr shows your new daily limit (typically 50,000 a day at 14 a second to start).

## What worked for us

Our first request, for Listenly, chose **Marketing**, led with moving a 5,000-person update list from another provider, and gave no volumes or sample. AWS denied it within a day with no reason.

We replied on the same case with a rewritten request. It led with transactional mail (sign-in codes, email-change confirmations, export notices), described the monthly update as secondary, and added daily, weekly and peak volumes, a sample sign-in email, and the bounce and complaint pipeline. It named the earlier case and what we'd gotten wrong. AWS granted production access a couple of days later: 50,000 emails a day, 14 a second.
