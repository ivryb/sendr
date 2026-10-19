#!/usr/bin/env bash
# Connects Amazon SES to a Sendr deployment. Run once per deployment with admin AWS credentials;
# it creates named resources, so a second run stops at the first one that already exists.
#
#   scripts/setup-ses.sh https://emails.example.com <webhook-secret> [region]
#
# The webhook secret is shown in Sendr under Settings > SES events. The script creates:
#   - the "sendr" SES configuration set, publishing delivery, bounce and complaint events
#     to the default EventBridge bus
#   - an EventBridge rule and API destination that POST those events to <url>/hooks/ses
#   - an IAM user allowed only to send through SES, and prints its access key
# Afterwards, store the printed key as the Worker's AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
# secrets. The sending domain itself must already be verified in SES.
set -euo pipefail

url="${1:?usage: setup-ses.sh <sendr-url> <webhook-secret> [region]}"
secret="${2:?usage: setup-ses.sh <sendr-url> <webhook-secret> [region]}"
region="${3:-us-east-1}"
url="${url%/}"
host="$(echo "$url" | sed -E 's#^https?://##; s#/.*$##')"
name="sendr-$(echo "$host" | tr '.' '-')"
account="$(aws sts get-caller-identity --query Account --output text)"
aws=(aws --region "$region")

step() { printf '\n==> %s\n' "$1"; }

step "SES configuration set \"sendr\""
"${aws[@]}" sesv2 create-configuration-set --configuration-set-name sendr 2>/dev/null ||
  echo "already exists"
"${aws[@]}" sesv2 create-configuration-set-event-destination \
  --configuration-set-name sendr \
  --event-destination-name eventbridge \
  --event-destination "{
    \"Enabled\": true,
    \"MatchingEventTypes\": [\"DELIVERY\", \"BOUNCE\", \"COMPLAINT\"],
    \"EventBridgeDestination\": {
      \"EventBusArn\": \"arn:aws:events:$region:$account:event-bus/default\"
    }
  }" 2>/dev/null || echo "event destination already exists"

step "EventBridge connection and API destination for $url/hooks/ses"
connection_arn="$("${aws[@]}" events create-connection \
  --name "$name" \
  --authorization-type API_KEY \
  --auth-parameters "ApiKeyAuthParameters={ApiKeyName=x-sendr-secret,ApiKeyValue=$secret}" \
  --query ConnectionArn --output text)"
destination_arn="$("${aws[@]}" events create-api-destination \
  --name "$name" \
  --connection-arn "$connection_arn" \
  --invocation-endpoint "$url/hooks/ses" \
  --http-method POST \
  --invocation-rate-limit-per-second 20 \
  --query ApiDestinationArn --output text)"

step "IAM role that lets EventBridge call the API destination"
role_arn="$(aws iam create-role \
  --role-name "$name-events" \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Allow", "Principal": { "Service": "events.amazonaws.com" }, "Action": "sts:AssumeRole" }]
  }' \
  --query Role.Arn --output text)"
aws iam put-role-policy \
  --role-name "$name-events" \
  --policy-name invoke-api-destination \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{ \"Effect\": \"Allow\", \"Action\": \"events:InvokeApiDestination\", \"Resource\": \"$destination_arn\" }]
  }"

step "EventBridge rule for SES delivery, bounce and complaint events"
"${aws[@]}" events put-rule \
  --name "$name-ses-events" \
  --event-pattern '{
    "source": ["aws.ses"],
    "detail-type": ["Email Delivered", "Email Bounced", "Email Complaint Received"]
  }' >/dev/null
# IAM is eventually consistent; the new role can take a few seconds to become assumable.
sleep 10
"${aws[@]}" events put-targets \
  --rule "$name-ses-events" \
  --targets "Id=sendr,Arn=$destination_arn,RoleArn=$role_arn" >/dev/null

step "IAM user that can only send email through SES"
aws iam create-user --user-name "$name-sender" >/dev/null
aws iam put-user-policy \
  --user-name "$name-sender" \
  --policy-name ses-send \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{ \"Effect\": \"Allow\", \"Action\": \"ses:SendEmail\", \"Resource\": \"*\" }]
  }"
"${aws[@]}" iam create-access-key --user-name "$name-sender" \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text |
  while read -r key_id key_secret; do
    cat <<EOF

Done. Store these as Worker secrets (they are shown only once):
  AWS_ACCESS_KEY_ID=$key_id
  AWS_SECRET_ACCESS_KEY=$key_secret

For example: printf '%s' '$key_id' | npx wrangler secret put AWS_ACCESS_KEY_ID
EOF
  done
