// The IAM policy for a sender's AWS key, shown on the Add sender page and in the API reference.
// It covers what Sendr does with the key: set up and check SES, send, and route delivery
// reports through its own SNS topic. Nothing else in the account.
export const SES_KEY_POLICY = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:*",
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["sns:CreateTopic", "sns:Subscribe", "sns:GetSubscriptionAttributes"],
      "Resource": "arn:aws:sns:*:*:sendr-*"
    }
  ]
}`
