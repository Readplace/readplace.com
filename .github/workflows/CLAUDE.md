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

## Workflows

Inspect the `.yml` files in this directory for implementation details. Summary:

| Workflow | Purpose | Trigger |
|----------|---------|---------|
| `ci.yml` | Base CI pipeline | push/PR to main |
| `claude-listener.yml` | Central hub - ONLY workflow that runs Claude | `@claude` comments |
| `claude-PR-CI-failure-fixer.yml` | Auto-fix CI failures (max 5 attempts) | CI fails on PR |
| `claude-PR-code-reviewer.yml` | Automated code review | CI succeeds on PR |
| `claude-PR-code-review-auto-apply.yml` | Fix HIGH/MEDIUM priority issues | Claude review comment |
| `claude-PR-conflict-fixer.yml` | Resolve merge conflicts | CI succeeds + conflicts detected |
| `tier-1-plus-crawl-pipeline-health.yml` | Tier 1+ crawl pipeline canary; opens a tracking issue on failure for an operator to debug and close manually | Schedule (06:00 AEST daily) / manual |
| `stuck-articles-canary.yml` | Surfaces articles stuck non-terminal whose URLs still resolve; opens or comments on a tracking issue on failure for an operator to debug and close manually | Schedule (06:30 AEST daily) / manual |
| `failed-articles-canary.yml` | Surfaces articles whose state machines reached a terminal unsuccessful outcome; opens a debug-worklist tracking issue when non-empty for an operator to debug and close manually; skips while a prior issue is open | Schedule (07:00 AEST daily) / manual |
| `submit-ff-extension-for-signing.yml` | Submit Firefox extension to AMO for signing | Called by `ci.yml` |
| `sync-signed-extension.yml` | Sync signed Firefox extension from AMO to S3 | Schedule (every 12h) / manual |
| `publish-ios-testflight.yml` | Build + upload the iOS app (app + share extension) to TestFlight on a macOS/Xcode-26 runner; tag-versioned, gated on iOS shipping-code changes | Called by `ci.yml` when `ios-affected` / manual |

## Prompt Files

Each PR automation workflow has a corresponding `.md` file containing detailed instructions for Claude. This separation prevents cascade issues where example markers in instructions trigger other workflows.

| Workflow | Prompt File |
|----------|-------------|
| `claude-PR-CI-failure-fixer.yml` | `claude-PR-CI-failure-fixer.md` |
| `claude-PR-code-reviewer.yml` | `claude-PR-code-reviewer.md` |
| `claude-PR-code-review-auto-apply.yml` | `claude-PR-code-review-auto-apply.md` |
| `claude-PR-conflict-fixer.yml` | `claude-PR-conflict-fixer.md` |

## Labels and Markers

| Label Pattern | Purpose |
|---------------|---------|
| `ci-fix-attempt-N` | Tracks CI fix attempts (1-5) |
| `auto-fix-attempt-N` | Tracks review auto-fix attempts (1-5) |

| HTML Marker | Purpose |
|-------------|---------|
| `<!-- CLAUDE_REVIEW_REQUEST -->` | Code review request |
| `<!-- CLAUDE_REVIEW_START/END -->` | Review content boundaries |
| `<!-- HIGH/MEDIUM_PRIORITY_COUNT: N -->` | Issue counts |
| `<!-- CLAUDE_CONFLICT_FIX -->` | Conflict fix request |
| `<!-- CLAUDE_TIER_1_PLUS_FIX -->` | Tier 1+ canary tracking-issue dedup marker (detection only; no Claude handoff) |
| `<!-- CLAUDE_FAILED_ARTICLES_FIX -->` | Failed-articles canary debug-worklist dedup marker (one open at a time; canary skips while present; detection only) |
