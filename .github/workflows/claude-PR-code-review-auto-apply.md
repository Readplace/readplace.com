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
