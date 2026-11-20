# Secrets management policy

This policy covers how Readplace stores server-side secrets, who can reach them, how access is recorded, and when they are rotated. It names roles, not people.

## Scope

- **Server-side secrets:** third-party API keys, OAuth client secrets, signing secrets, service tokens and the analytics salt. Today these are the environment variables `GOOGLE_LOGIN_CLIENT_SECRET`, `GMAIL_INTEGRATION_CLIENT_SECRET`, `GMAIL_INTEGRATION_STATE_SECRET`, `APPLE_LOGIN_PRIVATE_KEY_BASE64`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RECRAWL_SERVICE_TOKEN`, `ANALYTICS_SALT`, `DEEPSEEK_API_KEY`, `CRAWL_EGRESS_PROXY_URL`, `CRAWL_RESIDENTIAL_PROXY_URL` and `ADMIN_TOTP_SECRETS`, plus `SSR_EDGE_SECRET`, which Pulumi generates (the `ssr-edge-secret` `RandomPassword` in the platform stack) and no person ever types.
- **CI and store-publishing credentials** held as GitHub Actions secrets: deploy (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), repository automation (`PAT_TOKEN`, `TAG_PUSH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`), the crawl canaries (`CRAWL_CANARY_EMAIL`, `CRAWL_CANARY_PASSWORD`), the App Store (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`, `ASC_TEAM_ID`, `MATCH_PASSWORD`, `MATCH_GIT_URL`, `MATCH_GIT_BASIC_AUTHORIZATION` and the `ASC_REVIEW_*` demo account), Google Play (`PLAY_SERVICE_ACCOUNT_JSON`, `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`), the Chrome Web Store (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `CHROME_EXTENSION_ID`) and Firefox Add-ons (`AMO_JWT_ISSUER`, `AMO_JWT_SECRET`).
- **Gmail refresh tokens** stored in the `hutch-gmail-credentials` table. They are encrypted at rest under the customer-managed KMS key `hutch-gmail-credentials-key` (yearly rotation on), readable only by the Lambda roles granted that table, and revoked at Google when a reader disconnects Gmail (the `revokeGmailGrant` call in `projects/hutch/src/runtime/domain/gmail/disconnect-gmail.ts`).

## Where a secret may live

| Place | Protection |
|---|---|
| GitHub Actions environment secrets (`staging`, `prod`) | The source of truth. GitHub never shows a value after it is saved |
| GitHub Actions repository secrets: `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`, `APPLE_LOGIN_CLIENT_ID`, `APPLE_LOGIN_KEY_ID`, `APPLE_LOGIN_PRIVATE_KEY_BASE64`, `APPLE_LOGIN_TEAM_ID`, `CHROME_EXTENSION_ID`, `CLAUDE_CODE_OAUTH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `PAT_TOKEN` (read 2026-11-20) | GitHub never shows a value after it is saved, but no environment gates them: any workflow run in the repository can read them |
| SSM SecureString `/readplace/admin-totp-secrets` | Holds `ADMIN_TOTP_SECRETS`, encrypted under the AWS-managed key `alias/aws/ssm`. Only the web Lambda's role is granted `ssm:GetParameter` on it |
| Pulumi stack output `ssrEdgeSecret` (platform stack) | A secret output, encrypted in state like any other secret value. Other stacks read it by stack reference and pass it to the web Lambda's environment and the CloudFront origin header |
| Pulumi stack state | Each secret value is encrypted under the KMS key `alias/pulumi-state-secrets` |
| Lambda environment variables | Encrypted at rest by Lambda with KMS |
| The git-ignored `.env` file on a maintainer's own machine | Holds the values local development and infrastructure previews need. `.gitignore` lists `.env` |

A secret lives nowhere else: not in a tracked file, a plaintext stack output, a log line or client code.

## The rule for code

- A Pulumi program reads a secret as `pulumi.secret(requireEnv("NAME"))`, so the value is encrypted in state.
- A new Pulumi stack is created with `--secrets-provider "awskms://alias/pulumi-state-secrets?region=ap-southeast-2"`.

## Who has access

GitHub and AWS were read on 2026-11-13.

- **GitHub:** the organisation has one member, who is its only admin. The `prod` environment deploys from `main` only.
- **AWS:** each account (staging and production) has one IAM user, an administrator with access keys only and no console password. The root user has MFA. Every role is trusted only by an AWS service.
- Access for anyone else needs the owner's approval and is granted the least privilege the task needs.

## Logging

- The `hutch-audit-trail` CloudTrail trail records every management event in every region to the `hutch-audit-trail-<stage>` bucket: reads of a Lambda function's configuration, KMS decrypts (Lambda environment variables and Pulumi state), and IAM changes.
- GitHub's organisation audit log records each secret created, updated or removed.

## Rotation and review

The owner commits to the following:

- A secret is rotated when someone with access to it leaves, or when exposure is suspected.
- This policy and the access lists above are reviewed at each annual CASA reassessment.
- `ANALYTICS_SALT` rotates only under the rule in the [MCP skill](../../../.claude/skills/mcp/SKILL.md), because changing it re-keys every visitor hash.
