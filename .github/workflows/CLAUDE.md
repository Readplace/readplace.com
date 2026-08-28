# GitHub Actions CI Architecture

## Overview

This repository uses a centralized Claude automation architecture where only `claude-listener.yml` executes Claude directly. The PR automation workflows post `@claude` comments to PRs, which the listener picks up and processes. The crawl-health canaries are detection-only: they open a tracking issue describing the failure for an operator to debug and close manually — they do not hand off to Claude.

## Design Principles

| Principle | Description |
|-----------|-------------|
| Single Execution Point | Only `claude-listener.yml` runs Claude directly |
| Comment-Based Communication | All automation via `@claude` comments |
| Fresh Context | Each comment = new Claude instance with clean context |
| Auditable | All prompts visible in PR history |
| Retry Limits | Max 5 attempts for automated fixes |
| Separated Prompts | Instructions in `.md` files, comments contain only context |
| No Silent Failure | A request that cannot be served says so on the PR — the Claude action reports itself, `claude-listener.yml` reports every step outside it |
| Comment-Driven Recovery | Automated limits bound the automated loop only; a human `@claude` comment always re-enters the flow, and a push resets a per-head budget. No standing machinery (canaries, health issues) beyond the PR conversation itself |

## Workflows

Inspect the `.yml` files in this directory for implementation details. Summary:

| Workflow | Purpose | Trigger |
|----------|---------|---------|
| `ci.yml` | Base CI pipeline | push/PR to main |
| `perf-soak.yml` | Re-derives the save-latency budgets `ci.yml`'s `perf-tests` job gates on: 20 independent github-hosted runs, each uploading its own distribution | Manual |
| `screen-response-soak.yml` | Re-derives the budgets the hutch post-deploy screen-response ratchet gates on: N independent github-hosted runs against the deployed staging stack, one at a time, each uploading its own distribution | Manual |
| `claude-listener.yml` | Central hub - ONLY workflow that runs Claude | `@claude` comments |
| `claude-PR-CI-failure-fixer.yml` | Auto-fix CI failures (max 5 attempts) | CI fails on PR |
| `claude-PR-code-reviewer.yml` | Automated code review | CI succeeds on PR |
| `claude-PR-code-review-auto-apply.yml` | Post the review comment from the review run's saved output, then fix HIGH/MEDIUM issues | Review run completes (`workflow_run`) + the posted review comment |
| `claude-PR-conflict-fixer.yml` | Resolve merge conflicts | CI succeeds + conflicts detected |
| `claude-PR-crash-retry.yml` | Re-run `claude-listener.yml` on the intermittent agent-SDK startup crash (#852): fast failures of the agent step only, ≤4 attempts. A failure in a setup step or a usage-limit rejection is deterministic and never retried | `claude-listener.yml` run fails |
| `tier-1-plus-crawl-pipeline-health.yml` | Tier 1+ crawl pipeline canary; opens a tracking issue on failure for an operator to debug and close manually | Schedule (06:00 AEST daily) / manual |
| `stuck-articles-canary.yml` | Surfaces articles stuck non-terminal whose URLs still resolve; opens or comments on a tracking issue on failure for an operator to debug and close manually | Schedule (06:30 AEST daily) / manual |
| `failed-articles-canary.yml` | Surfaces articles whose state machines reached a terminal unsuccessful outcome; opens a debug-worklist tracking issue when non-empty for an operator to debug and close manually; skips while a prior issue is open | Schedule (07:00 AEST daily) / manual |
| `submit-ff-extension-for-signing.yml` | Submit Firefox extension to AMO for signing | Called by `ci.yml` |
| `sync-signed-extension.yml` | Sync signed Firefox extension from AMO to S3 | Schedule (every 12h) / manual |
| `publish-ios-testflight.yml` | Build + upload the iOS app (app + share extension) to TestFlight on a macOS/Xcode-26 runner; tag-versioned, gated on iOS shipping-code changes | Called by `ci.yml` when `ios-affected` / manual |
| `publish-ios-appstore-metadata.yml` | Push the App Store listing metadata (and optionally screenshots) from `fastlane/metadata` to App Store Connect as a draft via the fastlane `release` lane; a screenshot push is read back and fails the run unless the listing matches the committed files; the optional `build` input creates the `<major.minor>.<build>` version record; never uploads a binary or submits for review | Manual |
| `publish-ios-appstore-resubmit.yml` | Submit (or resubmit after a rejection) a TestFlight build for App Store review via the fastlane `resubmit` lane: reconcile the version string, attach the build, push metadata, submit — reusing a rejection's still-open review submission. Dispatching it is the deliberate human "Submit for Review" act | Manual |

## Prompt Files

Each workflow has a corresponding `.md` file containing detailed instructions for Claude. This separation prevents cascade issues where example markers in instructions trigger other workflows.

| Workflow | Prompt File |
|----------|-------------|
| `claude-PR-CI-failure-fixer.yml` | `claude-PR-CI-failure-fixer.md` |
| `claude-PR-code-reviewer.yml` | `claude-PR-code-reviewer.md` |
| `claude-PR-code-review-auto-apply.yml` | `claude-PR-code-review-auto-apply.md` |
| `claude-PR-conflict-fixer.yml` | `claude-PR-conflict-fixer.md` |
| `tier-1-plus-crawl-pipeline-health.yml` | `tier-1-plus-crawl-pipeline-health.md` |
| `stuck-articles-canary.yml` | `stuck-articles-canary.md` |
| `failed-articles-canary.yml` | `failed-articles-canary.md` |

## Labels and Markers

| Label Pattern | Purpose |
|---------------|---------|
| `ci-fix-attempt-N` | Tracks CI fix attempts (1-5) |
| `auto-fix-attempt-N` | Tracks review auto-fix attempts (1-5) |

| HTML Marker | Purpose |
|-------------|---------|
| `<!-- CLAUDE_REVIEW_REQUEST -->` | Code review request |
| `<!-- CLAUDE_REVIEW_START/END -->` | Review content boundaries; posted by `claude-PR-code-review-auto-apply.yml` from the review run's saved `execution_file` artifact (unsanitized), not by the agent |
| `<!-- REVIEW_RUN: <run-id> -->` | Dedup marker on the workflow-authored review comment (one per review run) |
| `<!-- HIGH/MEDIUM_PRIORITY_COUNT: N -->` | Issue counts |
| `<!-- CLAUDE_CONFLICT_FIX -->` | Conflict fix request |
| `<!-- CONFLICT_FIX_HEAD: <sha> -->` | The head SHA a conflict fix request (or its limit notice) was raised against; attempts are counted per SHA, so a push resets the budget |
| `<!-- CLAUDE_CONFLICT_FIX_LIMIT -->` | One-time notice that the conflict fix budget for a head SHA is spent |
| `<!-- CLAUDE_LISTENER_SETUP_FAILURE -->` | Posted on the PR/issue when the listener failed outside the Claude action, so no tracking comment exists; deduped to one per hour |
| `<!-- CLAUDE_TIER_1_PLUS_FIX -->` | Tier 1+ canary tracking-issue dedup marker (detection only; no Claude handoff) |
| `<!-- CLAUDE_FAILED_ARTICLES_FIX -->` | Failed-articles canary debug-worklist dedup marker (one open at a time; canary skips while present; detection only) |
