# Conflict Resolution Instructions

You have been triggered because this PR has merge conflicts with the `main` branch that need to be resolved.

## Your Task

1. **Understand what the PR is trying to do before touching anything.** Run `git log --format='%h %s%n%b' origin/main..HEAD` to read the full commit history (subject + body) between the PR branch and main. This tells you the intent behind every change — features added, code removed, refactors, etc. You need this context to avoid accidentally reverting intentional changes when resolving conflicts.
2. Rebase this PR onto main: `git fetch origin && git rebase origin/main`
3. Resolve any merge conflicts that arise — always cross-reference against the commit history from step 1 to understand whether the conflicting code was intentionally changed by the PR. For example, if the PR renamed a function and `main` still uses the old name, keep the PR's rename and update `main`'s usage — do not revert the rename to match `main`.
4. Focus ONLY on resolving conflicts — do not refactor, improve, or make unrelated changes
5. Run `pnpm check` to verify everything works after resolving conflicts
6. Push the changes: `git push origin <BRANCH> --force-with-lease`
7. Post a brief comment on the PR summarizing what conflicts were resolved using `gh pr comment <PR_NUMBER>`

## Important Guidelines

- Follow ALL CLAUDE.md guidelines when resolving conflicts
- Use `--force-with-lease` (not `--force`) for safety
- If conflicts are too complex to resolve automatically, post a comment explaining the situation using `gh pr comment <PR_NUMBER>` and exit gracefully
- **Never reverse intentional changes.** If the commit history shows something was deliberately added, removed, renamed, or refactored by the PR, preserve the PR's version and update the incoming code from `main` to be compatible — do not revert the PR's changes to match `main`. The commit history is the source of truth for what the PR intended.

## Applicable Skills

When resolving conflicts, apply these skills based on the files involved:

- **git-commit** (`.claude/skills/git-commit/SKILL.md`): If you need to create any commits during conflict resolution, follow the Conventional Commits format specified in this skill
- **test-driven-design** (`.claude/skills/test-driven-design/SKILL.md`): When resolving conflicts in test files or code that affects testability
- **e2e-testing** (`.claude/skills/e2e-testing/SKILL.md`): When resolving conflicts in E2E test files (`e2e/` directories, `*.e2e*.ts` files)
- **web** (`.claude/skills/web/SKILL.md`): When resolving conflicts in web adapter files (`.css`, `.html`, `.view.html`, `.client.js`)
- **ai-agent-editor** (`.claude/skills/ai-agent-editor/SKILL.md`): When resolving conflicts in skills, `CLAUDE.md`, or other AI-agent documentation
- **blog-post-editor** (`.claude/skills/blog-post-editor/SKILL.md`): When resolving conflicts in blog post markdown files
- **crawl-pipeline-rca** (`.claude/skills/crawl-pipeline-rca/SKILL.md`): When resolving conflicts in the article crawl pipeline (command/event/handler chain) — use the methodology to confirm both sides' state-machine writes survive the merge
- **hypermedia-api-design** (`.claude/skills/hypermedia-api-design/SKILL.md`): When resolving conflicts that touch the Siren/MCP hypermedia contract between the hutch server and any client (chrome/firefox extensions, iOS app, MCP) — action names, navigation flows, request/response shapes
- **infrastructure-design** (`.claude/skills/infrastructure-design/SKILL.md`): When resolving conflicts in Pulumi infrastructure
