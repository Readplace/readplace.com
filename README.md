# Readplace

A read-it-later app. Save articles, read them later. Built from a personal reading system I've been running for 10 years.

→ [readplace.com](https://readplace.com)

---

## The AI Engineering Workflow

This repo is also a working example of how I use Claude + GitHub Actions as a solo developer. The short version: Claude acts as an autonomous agent in the CI pipeline — reviewing PRs, fixing failures, resolving conflicts, and responding to natural-language instructions in issue comments.

### How it works

Every PR triggers a pipeline of Claude-powered workflows that run in parallel:

```
PR opened / updated
  ├── Claude Code Review      → reviews the diff, leaves comments
  ├── Claude CI Fix           → if CI fails, Claude attempts a fix and pushes a commit
  ├── Claude Conflict Fixer   → detects merge conflicts, resolves and commits
  └── Claude Auto Fix         → applies high-priority review suggestions automatically
```

You can also talk to Claude directly in any issue or PR comment. It will respond, create branches, open PRs, and commit code — all without leaving GitHub.

### The workflows

| File | What it does |
|---|---|
| `ci.yml` | Standard CI — lint, test, build |
| `claude-listener.yml` | Listens for `@claude` mentions in issues/comments. Claude reads the context and takes action. |
| `claude-PR-code-reviewer.yml` | Reviews every PR diff. Posts inline comments. Flags issues by severity. |
| `claude-PR-CI-failure-fixer.yml` | When CI fails, Claude reads the logs, diagnoses the failure, and pushes a fix commit. |
| `claude-PR-code-review-auto-apply.yml` | Takes high and medium-priority review comments and applies them automatically — no manual intervention needed. |
| `claude-PR-conflict-fixer.yml` | Detects merge conflicts on PRs and resolves them. |

Each workflow has a companion `.md` file (e.g. `claude-PR-CI-failure-fixer.md`) — that's the prompt file. Separating prompts from workflow orchestration keeps things maintainable and makes prompt iteration fast without touching the YAML.

### Design principles

**Single execution point.** Each workflow has one clearly defined trigger and one job. No fan-out inside a workflow — fan-out happens at the workflow level, which makes failures isolated and logs readable.

**Prompts are files, not strings.** Every Claude instruction lives in a `.md` file next to its workflow. This means prompts are version-controlled, diffable, and editable without YAML escaping headaches.

**Attempt counters prevent loops.** Workflows that push commits (CI fixer, conflict resolver) track attempt counts to avoid infinite retry loops. If Claude can't fix something in N attempts, it fails loudly instead of spinning.

**HTML markers for inter-workflow communication.** When one workflow needs to signal state to another, it uses HTML comments embedded in PR descriptions or issue bodies — durable, inspectable, no external state store needed.

### Setup

You need one secret: `ANTHROPIC_API_KEY`.

Add it to your repo's Actions secrets and the workflows work as-is. The Claude integration uses [`claude-code-action`](https://github.com/anthropics/claude-code-action).

```
Settings → Secrets and variables → Actions → New repository secret
Name: ANTHROPIC_API_KEY
Value: sk-ant-...
```

### What it looks like in practice

As of this writing the Actions tab shows 1,300+ workflow runs. Claude handles the mechanical parts (CI flakiness, review nits, conflict resolution) so I stay focused on architecture and product decisions.

The browser extension and web app in this repo were built through PR review cycles with Claude.

---

## The App

Readplace is a read-it-later app for people who actually read what they save.

**What works now:**
- Browser extension (Firefox) — save any page in one click
- Web app — view and manage saved articles

**Coming soon:**
- Chrome extension
- Import from Pocket, Instapaper, Omnivore exports
- Reader view with custom themes
- Full-text search
- Highlights and notes
- Offline reading
- Newsletter inbox

**Stack:** Node.js, TypeScript, DynamoDB, Pulumi. Deliberately boring infrastructure — after maintaining [js-cookie](https://github.com/js-cookie/js-cookie) for 10+ years (22B+ annual npm downloads), I've learned that the best tech stack is the one that doesn't need babysitting.

**Pricing:** Free for the first 50 members. $3.99/month for everyone else.
---

## Development

### Prerequisites

- [Devbox](https://www.jetify.com/devbox) (optional, provides Node.js + pnpm)

### Setup

```bash
pnpm install
```

### Commands

Check out the [package.json](./package.json) for all available commands.

---

## Questions / Community

Open an issue.
