# Tier 1+ Crawl Pipeline Canary Failure Investigation

You have been triggered because the `Tier 1+ crawl pipeline health` workflow failed. For ordinary sources the canary forces a re-crawl through prod's Lambda via `https://readplace.com/admin/recrawl?url=<url>` and asserts the parsed article contains a known substring. A failure means prod's Lambda could not parse a URL that real users save — production traffic is also blocked for that fingerprint class (Cloudflare TLS fingerprinting, Fastly JA3, AIA chain gap, oembed flip, parser regression, etc.). Archive cases are checked differently; see [Archive cases](#archive-cases).

## Your Task

1. **Read the issue body and any follow-up comments.** The issue body links to the failing workflow run.
2. **Read the `archive-health-evidence` artifact and the run summary.** A working retained article does not prove that a fresh archive fetch worked. A reported extension winner is not evidence that live content won.

## Important Guidelines

- Follow ALL CLAUDE.md guidelines.
- **Never delete an entry from `src/packages/crawl-article/scripts/health-sources.ts` to make the canary green.** Each entry exists because a real user tried to save that fingerprint class and the crawler broke on it. Removing one silently accepts that readers will get "Sorry, we couldn't save this link" for any URL matching that edge sniffer.
- **Never lower `POLL_TIMEOUT_MS` (2,400,000 ms — 40 minutes, sized to the SQS retry → DLQ → terminal-failure path), shorten `expectedContent`, or drop an `expectedDestinationUrl`** to make a flaky source pass. All three exist to surface real prod regressions; a destination mismatch means a wrapper URL (newsletter tracker, Apple News shell, archive snapshot) was saved as itself instead of the article it points at.
- **Never `--no-verify` the commit.** If pre-commit fails, fix the underlying issue.

## Applicable Skills

- **git-commit** (`.claude/skills/git-commit/SKILL.md`) — Conventional Commits format for any fix commit.
- **test-driven-design** (`.claude/skills/test-driven-design/SKILL.md`) — when the fix touches the crawler or parser code paths.
- **crawl-pipeline-rca** (`.claude/skills/crawl-pipeline-rca/SKILL.md`) — when the canary points at a recrawl Lambda chain that succeeded in the first handler but the row never reached `ready`; use the methodology before bumping Lambda timeouts, SQS visibility, or `maxReceiveCount` to "give it more room".
- **infrastructure-design** (`.claude/skills/infrastructure-design/SKILL.md`) — when the fix touches Pulumi infrastructure (Lambda config, IAM, EventBridge/SQS wiring).

## Archive cases

Archive cases do not use the recrawl endpoint: they log into a dedicated canary account and submit the normal readlist save form, so a failure can also be an identity, selection or account-configuration regression. Inspect the failed assertion before assigning the cause.

- A received CAPTCHA or HTTP error page is a candidate for the comparison, not a transport failure.
- An archive.today save that falls back to live, extension or retained content is partial coverage, never proof that the archive copy was fetched.
- What each case must prove is asserted by the evidence module in the canary's scripts directory — grep it for `retained content cannot make archive health pass`. Read the assertions there rather than inferring them from the run summary.
