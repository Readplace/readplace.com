# CI Failure Fix Instructions

You have been triggered because CI has failed on a pull request.

## Your Task

1. **Understand what the PR is trying to do before touching anything.** Run `git log --format='%h %s%n%b' origin/<BASE_BRANCH>..HEAD` to read the full commit history (subject + body) between the PR branch and the base branch. This tells you the intent behind every change — features added, code removed, refactors, etc. You need this context to avoid undoing intentional changes. For example, if a commit deliberately removed a function and CI fails because something still references it, the fix is to remove the leftover reference, NOT to restore the deleted function.
2. Run `gh run view <RUN_ID> --log-failed` to see detailed logs (the run ID is provided in the comment that triggered you)
3. Analyze the failure and identify the root cause — always cross-reference against the commit history from step 1 to understand whether the failing code was intentionally changed
4. Implement the fix - focus ONLY on fixing the CI failure, do not make unrelated changes
5. Run `pnpm check` to verify your fix works before pushing
6. Commit with message: `fix: resolve CI failure (attempt #N)` where N is the attempt number from the triggering comment
7. Push: `git pull --rebase origin <BRANCH> && git push origin <BRANCH>`
8. Comment on PR with summary: `gh pr comment <PR_NUMBER>`

## Important Guidelines

- Follow ALL CLAUDE.md guidelines when making fixes
- If git push fails due to conflicts: do NOT force push, try to resolve, or comment and exit gracefully
- Focus only on fixing the CI failure - do not refactor or improve unrelated code
- **Never reverse intentional changes.** If the commit history shows something was deliberately removed, renamed, or refactored, fix the failure by updating the code that still depends on the old state — do not restore what was intentionally removed. The commit history is the source of truth for what the PR intended.

## Applicable Skills

When fixing CI failures, apply these skills based on the type of failure:

- **git-commit** (`.claude/skills/git-commit/SKILL.md`): Follow the Conventional Commits format when creating fix commits
- **test-driven-design** (`.claude/skills/test-driven-design/SKILL.md`): When fixing test failures, coverage issues, or violations of testing conventions (dependency injection, assertion patterns, etc.)
- **e2e-testing** (`.claude/skills/e2e-testing/SKILL.md`): When fixing E2E test failures, including locator timeouts, FlowRunner issues, or Playwright-related errors
- **web** (`.claude/skills/web/SKILL.md`): When fixing issues in web adapter files (CSS selector issues, SSR patterns, client-side JS, HTML templates)
- **ai-agent-editor** (`.claude/skills/ai-agent-editor/SKILL.md`): When CI fails on skills, `CLAUDE.md`, or other AI-agent documentation (broken links, format checks)
- **blog-post-editor** (`.claude/skills/blog-post-editor/SKILL.md`): When CI fails on blog post markdown files
- **crawl-pipeline-rca** (`.claude/skills/crawl-pipeline-rca/SKILL.md`): When CI fails on the article crawl pipeline (state-machine rows stuck non-terminal, multi-Lambda chain timeouts, canary or SLO failures) — apply before bumping Lambda timeouts, SQS visibility, or `maxReceiveCount`
- **hypermedia-api-design** (`.claude/skills/hypermedia-api-design/SKILL.md`): When CI fails on the Siren/MCP hypermedia contract between the hutch server and any client (chrome/firefox extensions, iOS app, MCP) — action-name mismatches, missing navigation links, malformed entities
- **infrastructure-design** (`.claude/skills/infrastructure-design/SKILL.md`): When CI fails on Pulumi preview/deploy

## Diagnosing GitHub Actions Failures

GitHub Actions logs can be misleading due to output buffering. Follow this systematic approach to identify the actual root cause:

**1. Understand log buffering artifacts:**
- All stdout/stderr is buffered and flushed when the process exits
- Timestamps may all show the same second even for operations that took minutes
- Progress bars (e.g., Chromium download) can appear to fail mid-way, but this is a display artifact from buffered output being truncated

**2. Look at the END of the build for actual errors:**
- Coverage threshold failures appear after all tests complete
- The visible "error" in the middle of logs is often not the real cause
- Search for: `threshold`, `Coverage`, `ELIFECYCLE`, `exit code`

**3. Compare passing vs failing PRs:**
```bash
# Get workflow runs for comparison
gh pr checks <pr-number> --repo owner/repo
gh run view <run-id> --repo owner/repo --log-failed
```

**4. Common red herrings:**
- `ELIFECYCLE` error after progress bar - Usually means a later step failed, not the download
- Multiple "errors" in log - The LAST error is usually the real cause

**Example investigation flow:**
```bash
# 1. Get failed job details
gh pr checks <pr-number> --repo Readplace/readplace.com

# 2. Search logs for actual error (usually at the end)
gh run view <run-id> --log-failed 2>&1 | grep -E "threshold|Coverage|FAILURE"

# 3. Run locally to reproduce
CI=true pnpm check
```

**Rationale:** Log buffering in CI systems makes the first visible error often not the root cause.

**5. CI step exits with code 1 but no visible error in logs:**

The GitHub Actions runner scans all log output to mask secrets in multiple encoding formats. Single log lines exceeding ~100KB cause severe runner slowdowns, and very large total output (~4MB+) can cause log truncation or process termination.

**Symptoms:**
- `ELIFECYCLE Command failed with exit code 1` appears at the end of a very long log line (not on its own line)
- `--log-failed` output is entirely consumed by one task's verbose output, hiding the actual failing task
- The `Failed tasks:` NX summary is missing from the log (pushed out by verbose output)
- `gh run view --log` returns fewer lines than expected

**Diagnosis:**
```bash
# Download full logs as zip (bypasses streaming truncation)
gh api repos/OWNER/REPO/actions/runs/<RUN_ID>/logs \
  -H "Accept: application/vnd.github+json" > logs.zip
unzip logs.zip -d logs/

# Check the raw step log file size
wc -c logs/check/6_Run\ pnpm\ check.txt

# Find the actual failing NX task (often hidden by verbose output)
grep "Failed tasks:" logs/check/6_Run\ pnpm\ check.txt -A 5
```

**Root cause in this repo:** The dev-mode AI summary stub in `projects/hutch/src/runtime/app.ts` logged the full `params` JSON via `JSON.stringify(params)`. Each call included the entire article text content as the `messages[0].content` field. For Wikipedia articles used in E2E tests, this produced ~100KB per log line. The runner's secret-masking scan on these lines caused the step to exit with code 1 before later NX tasks could report their results. The fix was to log only the model name and content length instead of the full params.

**General rule:** If a CI step fails with exit code 1 and the logs are dominated by a single task's massive output, suspect that the output itself is causing the failure. Reduce the verbosity and re-run before investigating other causes.
