# Tier 1+ Crawl Pipeline Canary Failure Investigation

You have been triggered because the `Tier 1+ crawl pipeline health` workflow failed on its scheduled run. The canary forces a re-crawl through prod's Lambda via `https://readplace.com/admin/recrawl?url=<url>` and asserts the parsed article contains a known substring. A failure means prod's Lambda could not parse a URL that real users save — production traffic is also blocked for that fingerprint class (Cloudflare TLS fingerprinting, Fastly JA3, AIA chain gap, oembed flip, parser regression, etc.).

## Your Task

1. **Read the issue body and any follow-up comments.** The issue body links to the failing workflow run.

## Important Guidelines

- Follow ALL CLAUDE.md guidelines.
- **Never delete an entry from `src/packages/crawl-article/scripts/health-sources.ts` to make the canary green.** Each entry exists because a real user tried to save that fingerprint class and the crawler broke on it. Removing one silently accepts that readers will get "Sorry, we couldn't save this link" for any URL matching that edge sniffer.
- **Never lower `POLL_TIMEOUT_MS` (180s) or shorten `expectedContent`** to make a flaky source pass. Both exist to surface real prod regressions.
- **Never `--no-verify` the commit.** If pre-commit fails, fix the underlying issue.

## Applicable Skills

- **git-commit** (`.claude/skills/git-commit/SKILL.md`) — Conventional Commits format for any fix commit.
- **test-driven-design** (`.claude/skills/test-driven-design/SKILL.md`) — when the fix touches the crawler or parser code paths.
- **crawl-pipeline-rca** (`.claude/skills/crawl-pipeline-rca/SKILL.md`) — when the canary points at a recrawl Lambda chain that succeeded in the first handler but the row never reached `ready`; use the methodology before bumping Lambda timeouts, SQS visibility, or `maxReceiveCount` to "give it more room".
- **infrastructure-design** (`.claude/skills/infrastructure-design/SKILL.md`) — when the fix touches Pulumi infrastructure (Lambda config, IAM, EventBridge/SQS wiring).
