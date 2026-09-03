---
name: git-commit
description: Format git commit messages following Conventional Commits specification. Use when the user asks to commit, create a commit, stage and commit, write a commit message, or mentions "git commit". Applies to all commits in this monorepo.
---

# Git Commit Message Convention

This monorepo follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Refer to that specification for format details, types, and breaking change conventions.

## Scope Rules

The scope **must** be the nx project name of the project whose files are being changed — `pnpm nx show projects` lists them; where a project has a `package.json`, that is its `name` field.

| Scenario | Format |
|----------|--------|
| Single project | `type(project): description` |
| 2-3 projects | `type(project1,project2): description` |
| More than 3 projects | `type: description` (omit scope) |
| Root/monorepo only | `type: description` (omit scope) |

## How to Determine the Scope

1. Check which files are being committed using `git status` and `git diff --staged`
2. Identify which nx project each file belongs to — the nearest ancestor directory carrying its own nx project definition; `pnpm nx show projects` lists them (e.g., the `flights` project's root)
3. Use the project's name as nx reports it

## Important Notes

- Always use lowercase for type and scope
- Keep the description concise (ideally under 72 characters)
- Use imperative mood ("add" not "added" or "adds")

## Pre-commit Hook Failures

When the pre-commit hook fails, follow this diagnostic process **before** asking the user to bypass hooks:

### Step 1: Pull Latest from Upstream

```bash
git stash --include-untracked
git pull --rebase origin main
git stash pop
```

### Step 2: Verify if Issue is Pre-existing

```bash
git stash --include-untracked
pnpm check  # Run on clean main
```

- If clean main passes: The issue is with your changes. Restore with `git stash pop` and investigate.
- If clean main fails: The issue is pre-existing. Report this to the user.

### Step 3: Handle Missing Module Errors

If the hook fails with `TS2307: Cannot find module` for a workspace package, the symlink in `node_modules` may be stale. Run `pnpm install` to re-link workspace packages, then retry.

### Step 4: Handle Stale Coverage Data

If coverage shows 0% for new files, run a fresh test cycle:

```bash
pnpm compile && pnpm test
```

### Step 5: Handle Stale Nx Cache

If tests pass when run directly with `--skip-nx-cache` but fail during the hook, the Nx cache may be stale. Run `pnpm nx reset` to clear the cache, then retry the commit.

### Step 6: Fix Failing Tests

If tests fail after your changes, update the tests to match the new behavior rather than asking to bypass hooks.

### Never Bypass Hooks Without User Approval

Only ask to bypass with `--no-verify` after completing the diagnostic steps above and confirming the issue is genuinely pre-existing.

## Post-Push CI Watch (Main Branch Only)

When a commit is pushed directly to the `main` branch, watch the GitHub Actions CI run to ensure it passes:

1. After pushing, check the CI status using `gh run list --branch main --limit 1` and `gh run watch`
2. If CI fails, read the logs with `gh run view <run-id> --log-failed`, diagnose the failure, fix it, and push a new commit
3. Repeat until CI passes

This only applies to commits pushed directly to `main`. For commits on feature branches, the existing PR workflows (CI fixer, code review) handle failures automatically.

### Approving a Run That Asks for Approval

A run reporting `action_required` with no jobs is waiting for a human to let it start — it has not failed. **Approving it is authorised standing work: do it without asking, then carry on watching.** The authorisation covers CI approvals only — starting a held run and releasing a deployment gate. It is not licence to approve pull requests or work around branch protection.

On `main` the workflow goes on to deploy, so a deploy is the expected consequence of the approval rather than a surprise.

`gh run` has no `approve` subcommand; the REST API carries it, but only for two of the three ways a run is held:

| Held on | Release with |
|---|---|
| A fork pull request, or a run the Actions bot queued | `gh api -X POST repos/{owner}/{repo}/actions/runs/<id>/approve` |
| A job at an environment gate (`pending_deployments` returns a non-empty array) | `POST` the same run's `pending_deployments`, supplying its required `environment_ids`, `state`, and `comment` |

The third way has no CLI release at all, so do not spend calls hunting for one: a **push** run held by an org policy — non-fork, no jobs, `pending_deployments` empty — refuses `approve` (`403 not from a fork pull request or queued by the Actions bot`), `gh run rerun` (`cannot be retried through the API`), and both check-suite rerequests (REST `404`, GraphQL `can only be accessed by a GitHub App`). Ask the human to approve it in the web UI, or land a further push; a `workflow_dispatch` re-trigger is not a substitute when the job being waited on is gated on `github.event_name == 'push'`.
