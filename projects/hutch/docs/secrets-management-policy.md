# Secrets management policy

This policy covers how Readplace stores server-side secrets, who can reach them, how access is recorded, and when they are rotated. It names roles, not people.

## Scope

- **Server-side secrets:** third-party API keys, OAuth client secrets, signing secrets, service tokens and the analytics salt. Today these are the environment variables `GOOGLE_LOGIN_CLIENT_SECRET`, `GMAIL_INTEGRATION_CLIENT_SECRET`, `GMAIL_INTEGRATION_STATE_SECRET`, `APPLE_LOGIN_PRIVATE_KEY_BASE64`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RECRAWL_SERVICE_TOKEN`, `ANALYTICS_SALT`, `DEEPSEEK_API_KEY`, `CRAWL_EGRESS_PROXY_URL` and `CRAWL_RESIDENTIAL_PROXY_URL`.
- **Gmail refresh tokens** stored in the `hutch-gmail-credentials` table. They are encrypted at rest by DynamoDB, readable only by the Lambda roles granted that table, and revoked at Google when a reader disconnects Gmail (the `revokeGmailGrant` call in `projects/hutch/src/runtime/domain/gmail/disconnect-gmail.ts`).

## Where a secret may live

| Place | Protection |
|---|---|
| GitHub Actions environment secrets (`staging`, `prod`) | The source of truth. GitHub never shows a value after it is saved |
| Pulumi stack state | Each secret value is encrypted under the KMS key `alias/pulumi-state-secrets` |
| Lambda environment variables | Encrypted at rest by Lambda with KMS |
| The git-ignored `.env` file on a maintainer's own machine | Holds the values local development and infrastructure previews need. `.gitignore` lists `.env` |

A secret lives nowhere else: not in a tracked file, a stack output, a log line or client code.

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
