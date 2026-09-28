---
name: token-usage-audit
description: Audit Claude Code token usage across every local clone of this repository and turn the waste patterns into CLAUDE.md rules, skills, hooks and settings, applied one by one on approval. Use when asked to analyze or reduce token usage/cost or to find skill and guideline candidates.
disable-model-invocation: true
argument-hint: "[--since-days N] [--no-unverified]"
allowed-tools: Bash(python3 *) Read
---

# Token usage audit

Find where Claude Code spends tokens in this repo, across all its local clones, and propose repo changes that cut that spend. A bundled script does the number crunching, so the audit itself stays cheap: **read only the digest it writes, never the raw transcripts or the script source.**

## 1. Run the analysis

```bash
python3 "${CLAUDE_SKILL_DIR}/token_usage_audit.py" $ARGUMENTS
```

- If `${CLAUDE_SKILL_DIR}` did not expand, the script is next to this file (the skill's base directory).
- The script discovers every clone of this repo on the machine and reads their transcripts and `~/.claude/history.jsonl`. It excludes this session. Run it from anywhere inside a clone.
- It prints a summary of 40 lines or less, ending with the path of `digest.json`. Outputs go to `.claude/token-usage-audit/<timestamp>/`, which ignores itself through its own `.gitignore`.
- Useful flags: `--since-days N`, `--no-unverified`, `--clones-only`, `--explain <finding-or-cluster-id>`. See `--help` for the rest.

## 2. Confirm the clones

Show the clone table from the summary. If any clone's confidence is `probable` or `unverified`, ask the user (AskUserQuestion) whether to keep those clones. If the answer is no, rerun with `--no-unverified`.

If there are no transcripts and no history, stop. Report that, and recommend a longer `cleanupPeriodDays` so there is data next time.

## 3. Read the digest and judge it

`Read` the `digest.json` file. It already holds everything deterministic: deduplicated token and $ totals, findings H00–H19 with evidence, prompt clusters, corrections, cache misses, hot paths, subagent economics, and the current repo and user config (`repo_config`). Your job is the judgement the script can't make.

- **Real vs noise.** Is a prompt cluster a real repeatable procedure? Was a big output, a high effort level or a long session actually needed?
- **Pick one artifact per problem.** Use the cheapest artifact that fixes it (table below).
- **Merge and filter:**
  - Merge overlapping findings.
  - Drop findings that `existing_coverage` shows are already handled. If they persist anyway, escalate: rule → hook.
  - Resolve contradictions. For example, a "commit and push" cluster alongside "do not commit" corrections means a rule plus an explicit skill, not a blanket ban.
- **Personal vs team.** Treat `memory.promotable` entries and user-level settings as personal until the user says otherwise.
- **Count the cost of the fix.** Keep a recommendation only if its saving clearly beats its own cost:
  - A CLAUDE.md line is paid in every session of every clone.
  - A skill costs only its description, and nothing at all with `disable-model-invocation: true`.
- **Getting more context.** Use `python3 "${CLAUDE_SKILL_DIR}/token_usage_audit.py" --explain <id>` (max ~5 calls). Open repo files only to draft a change, e.g. a CLAUDE.md project map, and read them with `head`/`sed -n`, never whole large files.
- **Settings and hook keys.** Before proposing any settings or hook key you are not certain of, check it against the Claude Code docs (claude-code-guide agent).

| `artifact_hint` | Where the change goes | Use it when |
|---|---|---|
| `claude_md` | Root `CLAUDE.md`, a nested `CLAUDE.md`, or `.claude/rules/<topic>.md` with `paths:` when the rule only matters for a subtree | A standing preference or correction. One imperative line per rule. |
| `skill` | `.claude/skills/<verb-noun>/SKILL.md`, with deterministic steps in a bundled script | A repeated multi-step procedure. Put the cluster's own phrasings in the description as triggers. |
| `hook` | `.claude/settings.json` `hooks` plus `.claude/hooks/<name>.py` | Mechanical enforcement, or a rule that exists and is still violated. |
| `agent` | `.claude/agents/<name>.md`, cheaper `model:` and a small return budget | Verbose exploration or log digging that floods the main context. |
| `settings` | `.claude/settings.json` (repo), `.claude/settings.local.json` (this clone only) | Model, effort, env and permission defaults. |
| `user_settings` | `~/.claude/settings.json` | Machine-wide items such as `cleanupPeriodDays`, plugins and MCP servers. Always flag them as affecting all projects. |
| `workflow` | No file, advice only | Habits like `/clear` between tasks or `/compact` before a break. |

**Where each change applies:**
- **`repo` scope** (committed files) reaches every clone after a commit and `git pull`.
- **`local` scope** affects only this clone.
- **`user` scope** affects the whole machine.

## 4. Write the report

Write `report.md` next to `digest.json`:

```markdown
# Token usage audit: <repo>, <date>
Scope: <n> clones (<names>), <window>. Transcripts cover <x>% of sessions; the rest comes from prompt history only.
Spend: $<window> measured, ~$<month>/month (<confidence>). Mix: cache read <a>%, cache write <b>%, output <c>%.
(API list prices. On a subscription, read these as usage-limit pressure.)

## Recommendations
| # | Change | Artifact | Scope | Est. saving/month | Confidence |
|---|--------|----------|-------|-------------------|------------|

### 1. <imperative title>
- Evidence: <numbers + at most 2 short excerpts from the digest>
- Change: <exact file path and the exact content or diff to apply>
- Why it saves tokens: <one line>

## Considered and rejected
<one line each: finding id, reason>

## Data limits
<from digest `limits` and `coverage`>
```

Rank by estimated saving. Keep the list to the recommendations worth doing, usually 10 or fewer. Never copy tool output or secrets into the report.

## 5. Offer to apply, one at a time

1. **Show the summary.** Reply with the recommendations table and the report path (≤ 15 lines).
2. **Ask which to apply.** Use AskUserQuestion with multiSelect: up to 4 recommendations per question and up to 4 questions per call, grouped by scope. With more than 16, ask the user to reply with numbers.
3. **Apply each accepted one in order:**
   - Show the exact change, make it with Edit/Write, and show the resulting diff in one line or a short excerpt.
   - Ask a separate yes/no before any `user`-scope change.
   - Never touch the other clones' working trees directly.
   - Never `git add`, commit or push. The user reviews the diff first.
4. **Wrap up.** List every file changed, and remind the user that `repo`-scope changes reach the other clones only after they commit and each clone runs `git pull`.
