# Auto-Fix Review Issues Instructions

You have been triggered because a code review identified HIGH PRIORITY or MEDIUM PRIORITY issues that must be fixed.

## Your Task

1. Read the review comment referenced in the triggering comment
2. Identify ONLY the HIGH PRIORITY and MEDIUM PRIORITY issues
3. For each of those issues, implement the fix
4. DO NOT fix low priority issues
5. After making all fixes, create a single commit with message: "fix: address high/medium priority review issues"
6. Push the commit to the PR branch

## Important Guidelines

- Only fix issues marked as High Priority or Medium Priority
- Follow ALL CLAUDE.md guidelines when making fixes relative to the folders being changed
- Run `pnpm check` to ensure fixes don't break existing functionality

## Fixes That Change Screenshots

When a fix changes what a visual test captures (whether the issue asks for a visual change or a code fix moves pixels as a side effect), the baselines are part of the fix.

- Confirm that the screenshot change is the one the review issue asks for. An unintended change is a defect: fix the code and leave the baseline alone.
- Regenerate the affected baselines yourself, following the **Regenerating Baselines** section of the e2e-testing skill. This job runs on Linux with the pinned browsers and fonts already in place, so you need no Docker. Regenerate only the affected specs, a few at a time, through the project's `update-visual-baselines` target.
- Open every regenerated PNG at full size and fix any visual defect it shows in the code.
- Run `pnpm check` with E2E enabled, then put the source and baseline changes in the same single fix commit. Do not leave the baselines for a later CI-fix run.
- Never loosen a screenshot tolerance, delete a checkpoint, or weaken an assertion.
- In your PR comment, list the specs you regenerated, what the images showed, and the verification result. If an environment step failed, quote its exact error.

## Applicable Skills

When fixing review issues, apply these skills based on the files being changed:

- **git-commit** (`.claude/skills/git-commit/SKILL.md`): Follow the Conventional Commits format when creating the fix commit
- **test-driven-design** (`.claude/skills/test-driven-design/SKILL.md`): When fixing test-related issues, coverage problems, or testability patterns
- **e2e-testing** (`.claude/skills/e2e-testing/SKILL.md`): When fixing E2E test issues (`e2e/` directories, `*.e2e*.ts` files)
- **web** (`.claude/skills/web/SKILL.md`): When fixing web adapter issues (CSS, HTML templates, client-side JS, SSR patterns)
- **ai-agent-editor** (`.claude/skills/ai-agent-editor/SKILL.md`): When fixing issues in skills, `CLAUDE.md`, or other AI-agent documentation
- **blog-post-editor** (`.claude/skills/blog-post-editor/SKILL.md`): When fixing issues in blog post markdown files
- **crawl-pipeline-rca** (`.claude/skills/crawl-pipeline-rca/SKILL.md`): When fixing issues in the article crawl pipeline (command/event/handler chain over Lambda + EventBridge + SQS)
- **hypermedia-api-design** (`.claude/skills/hypermedia-api-design/SKILL.md`): When fixing issues in the Siren/MCP hypermedia contract between the hutch server and any client (chrome/firefox extensions, iOS app, MCP)
- **infrastructure-design** (`.claude/skills/infrastructure-design/SKILL.md`): When fixing Pulumi infrastructure issues

## Git Push Instructions

Before pushing, pull the latest changes to avoid conflicts:
```
git pull --rebase origin <BRANCH>
```

Then push your changes:
```
git push origin <BRANCH>
```

If push fails due to conflicts:
1. Do NOT force push
2. Try to address the conflicts, take the time needed to be able to address it
3. If unable to address the conflicts, post a comment explaining the conflict using `gh pr comment <PR_NUMBER>`
4. Exit gracefully - manual intervention will be required

After pushing successfully, post a brief comment on the PR summarizing what was fixed, the approach used and why you decided that approach, using `gh pr comment <PR_NUMBER>`.
