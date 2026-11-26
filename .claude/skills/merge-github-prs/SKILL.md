---
name: merge-github-prs
description: 'Get open, non-draft pull requests green and squash-merged into main, or handed to the owner when only they can unblock one, in a loop that keeps watching for new PRs even when none are open. Use when asked to "merge all PRs", "merge the ready PRs", "land the open PRs", "make sure all PRs are merged", "babysit the PRs", "keep watching the PRs", "get PR #N in", or "why is PR #N blocked"; when a PR shows `mergeStateStatus` `DIRTY`, a failing or flaky check, or a missing, stale or failed Visual Review; and when a CI run on main fails after a PR merge.'
---

# Merging GitHub PRs

When asked about every PR, each open non-draft PR must end in one of two states, including PRs opened while you work:
- merged into `main` as one squash commit with a clean message;
- [handed over](#hand-over), with the exact action the owner must take.

When asked about one PR, apply the same rules to that PR only. Merge only when the request asks for it. "Why is PR #N blocked" means diagnose it and report back; do not merge.

`main` has no required checks or reviews, so `gh pr merge` will land a red PR. The readiness rules below are the only gate.

## The loop

Work in passes inside a loop. A pass lists the candidates, takes each one as far as it can go now, reports, and schedules the next pass. A PR's CI outlasts a turn, and new PRs keep arriving, so one pass is rarely the end.

| Request | Loop |
|---|---|
| Every PR | Never end the loop yourself. A pass that finds no candidate is a normal pass: schedule the next one. The loop ends only when the owner asks, or when this session closes. |
| One PR, to merge it | Loop until that PR is merged, closed or handed over. |
| One PR, to diagnose it | One pass. Do not start a loop. |

Start the loop by invoking the `loop` skill with `/merge-github-prs` as its argument, plus the PR number for a one-PR request, and no interval, so that it paces itself. It runs the first pass straight away. Start it only when this session is not already looping this skill: a wakeup that fires `/merge-github-prs` is the loop's next pass, not a request for a new loop.

For a request about every PR, the table above overrides the loop skill's reasons to stop. An empty listing, or one that holds only drafts, stacked PRs and handed-over PRs, is neither a finished task nor a loop that cannot make progress: the next pass can find a PR opened in the meantime.

End each pass by calling `ScheduleWakeup` with the loop's prompt. Pick its delay by what the soonest merge waits on:

| The soonest merge waits on | Next pass in | Why |
|---|---|---|
| Visual Review or the bot review, after CI has finished | About 5 minutes | Both start when CI completes. Visual Review finished within 5 minutes in 9 runs out of 10 (149 runs, 2026-11-17 to 2026-11-19). The bot's verdict came within 3 minutes of its request in 9 reviews out of 10 (111 reviews on 38 PRs, 2026-11-11 to 2026-11-19). |
| A running check: a PR's CI, a re-run, or `main`'s run | About 20 minutes | Half of PR CI runs took more than 71 minutes, and only 1 in 10 finished within 24 minutes (108 runs, 2026-11-15 to 2026-11-19). |
| Nothing running: no candidate, or only drafts, stacked PRs and handed-over PRs | About 30 minutes | A PR opened just after a pass cannot be ready before its CI finishes, and 9 PR CI runs in 10 took 24 minutes or more. |

## Scope

List the candidates with the REST pulls endpoint. It pages fully and reports drafts, forks, bases, labels and titles:

```bash
R=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
gh api --paginate "repos/$R/pulls?state=open&per_page=100" \
  --jq '.[] | "\(.number) \(if .draft then "DRAFT" else "open" end) \(if .head.repo.full_name == .base.repo.full_name then "same-repo" else "FORK" end) head=\(.head.ref) base=\(.base.ref) labels=\([.labels[].name] | join(",")) title=\(.title)"'
```

| PR | Do |
|---|---|
| `DRAFT` | Leave it. A draft is its author saying "not yet". |
| `FORK` (a deleted fork shows as `FORK` too) | Hand it over. Its code must not run on the self-hosted runners or under the AWS profiles. Visual Review skips forks, so a fork PR can never be ready. |
| Base is not `main` (stacked) | Leave it. CI runs only for PRs into `main`, so a stacked PR has no checks. See [Stacked PRs](#stacked-prs). |
| Carries `needs-manual-intervention`, `pending-decision` or `POC`, or its title or body says "do not merge" | Hand it over, or leave it if it was already handed over. Someone has already said a human decides. |
| Changes `.github/workflows` | Merge it last, and tell the owner first. Its push to `main` can re-arm GitHub's "may be malicious" hold. That hold stops every later run until the owner approves it in the browser ([git-commit skill](../git-commit/SKILL.md#approving-a-run-that-asks-for-approval)). |

A same-repo branch is trusted because only the owner can push to this repository, and the `@claude` listener answers only collaborators.

### Stacked PRs

`--delete-branch` closes every PR whose base is the branch it deletes. Before merging a PR, look in the listing for PRs whose `base=` is its `head=`. Retarget each one to `main` with `gh pr edit <child> --base main`, or hand the stack over. Drafts in the stack appear in the listing too; retarget them as well.

## When a PR is ready

```bash
gh pr view "$N" --repo "$R" --json mergeStateStatus,headRefOid,reviewDecision,statusCheckRollup \
  --jq '{mergeStateStatus, headRefOid, reviewDecision, checks: [.statusCheckRollup[] | {
    name: (.name // .context),
    result: (if .__typename == "CheckRun" and .status != "COMPLETED" then .status else (.conclusion // .state) end),
    at: (if .__typename == "CheckRun" then (if .status == "COMPLETED" then .completedAt else null end) else .startedAt end),
    url: (.detailsUrl // .targetUrl)}]}'
```

| Condition | Why |
|---|---|
| Every `result` is `SUCCESS`, `SKIPPED` or `NEUTRAL`. `IN_PROGRESS`, `QUEUED` or `PENDING` means wait; anything else is a failure. | `perf-tests` gates every deploy on `main`. `ios-tests` and `android-tests` are the only tests of an app change. |
| `Visual Review` is `SUCCESS`, **and** its `at` is later than `web-tests`' `at`. | Visual Review is a commit status keyed by the head SHA. After a re-run it shows the previous attempt's verdict until the new one posts. It starts only after the whole CI run completes, so while CI runs it is absent, not pending. |
| `mergeStateStatus` is not `DIRTY` or `UNKNOWN`. | `UNKNOWN` means GitHub is still computing, usually right after another merge. Read it again. |
| `reviewDecision` is not `CHANGES_REQUESTED`. | A human asked for changes; hand the PR over. |
| The "Claude Code Review" bot has reviewed `headRefOid` with no high-priority finding. Check with the [review query](#bot-review) below. | The bot reviews each head after CI succeeds. A high-priority finding starts auto-apply, which pushes fix commits to the branch. |
| Save `headRefOid` from this read as `SHA`. | The merge passes it to `--match-head-commit`. A push after this read then refuses the merge instead of landing unchecked code. |

From push to verdict, about 40 to 90 minutes is normal, and `web-tests` has no timeout, so the [loop](#the-loop)'s next pass re-checks the PR. If a PR has made no progress for about 2 hours, report it once as still running, and keep watching it.

### Bot review

```bash
gh api --paginate "repos/$R/issues/$N/comments" --jq '.[] | select(.body | test("CLAUDE_REVIEW_REQUEST|CLAUDE_REVIEW_START")) | {at: .created_at, commit: ((.body | capture("<!-- COMMIT: (?<c>[0-9a-f]+)") | .c) // null), high: ((.body | capture("HIGH_PRIORITY_COUNT: (?<h>[0-9]+)") | .h) // null)}'
```

To pass, the newest entry with a `commit` must equal `$SHA`, and the entry after it must show `high` `"0"`.

| Result | Do |
|---|---|
| The newest `commit` is an older SHA, or no review follows it yet | Wait for the review |
| `high` is greater than 0 | Wait for auto-apply's push and the CI that follows it, or fix the finding yourself |

### Symptoms

| Symptom | Do |
|---|---|
| `checks` is empty, or `web-tests` is missing or `CANCELLED` | Run `gh run list --repo "$R" --workflow ci.yml --commit "$SHA" --json databaseId,status,conclusion`. If the run is `action_required`, see [Held runs](#held-runs). If it is `cancelled`, run `gh run rerun <id>`. |
| `web-tests` failed on a test the diff does not touch | Run `gh run rerun <ci-run-id> --failed`. If the same test fails a second time, the failure is real. Check first whether `main` fails that test too. If it does, merge the fixed `main` into the branch rather than fixing it on the PR. |
| `web-tests` failed on a screenshot mismatch the PR intends | Follow the e2e-testing skill's [Regenerating Baselines](../e2e-testing/SKILL.md#regenerating-baselines). |
| `Visual Review` failed with `The model confirmed N defect(s)` | Open the run's `visual-review-failed-with-N-confirmed-defects-…` artifact. If a defect is real, it is a real failure: fix it. If it is a false positive, hand it over with the artifact link. Do not re-run the review to get a different verdict. |
| `Visual Review` failed with `No transition frames reached` | `web-tests` failed first, so handle that failure. The next CI completion runs the review again. |
| `Visual Review` failed with `No frames directory` and no record of a clean review | Re-run the CI run with all jobs. If that run is `action_required`, see [Held runs](#held-runs). |
| `Visual Review` hit a model-server timeout, or is stuck `PENDING` | Re-run that review run once. Its run id is the tail of the check's `url`; the newest review run listed may belong to another PR. |
| A real failure | [Fix it yourself](#fix-it-yourself). If two fixes fail, hand it over. |

### Held runs

A held run of a same-repo branch may be approved as the git-commit skill describes. Before approving, confirm with `gh api "repos/$R/actions/runs/<id>" --jq .head_repository.full_name` that the run's head is `$R`. Never approve a fork's run: hand it over. This rule overrides the git-commit skill's table for PR runs.

## Fix it yourself

Fix a failing PR locally and push to its branch. Do not tag `@claude`. The owner asked for local fixes because:
- a bot round-trip costs a CI cycle and a self-hosted runner slot;
- a local fix is verified before it is pushed.

The repo's own workflows still tag `@claude` automatically on a failed PR CI run or a conflict, so expect another writer on the branch.

| Step | Why |
|---|---|
| Run `git fetch origin`, then `git worktree add --detach .claude/worktrees/<name> origin/<branch>`. | It leaves the main checkout and other PRs untouched. It also works while the author's session still has the branch checked out. `.claude/worktrees/` is git-ignored. |
| Run `pnpm install` in the new worktree before any commit. | The install creates Git's hook path. Without it, a commit runs no hook and gives no warning, which is `--no-verify` by accident. |
| Before pushing, run `git fetch origin` again. If the branch moved because a bot or the author pushed, run `git merge --no-commit --no-ff origin/<branch>`, then `git commit --no-edit`. | Push with a plain `git push origin HEAD:<branch>`, never a force-push. A refused push means someone else wrote: fetch, merge and retry. |
| Remove the worktree once the PR is merged. | Each worktree holds a full install. |

Heavy work:
- A commit runs the check in its pre-commit hook, so it is a heavy task. CLAUDE.md allows [at most three heavy tasks at once](../../../CLAUDE.md#delegated-agents-never-run-the-full-check).
- Every push or rerun also starts `web-tests` and Visual Review on the self-hosted runners, which count toward that cap.

Delegation:
- A delegated fix or conflict resolution runs on the model and effort that CLAUDE.md's [model table](../../../CLAUDE.md#which-model-for-which-work) gives coding work, named on the call.
- The agent edits and runs only the failing test.
- This session runs every commit that fires the hook, including the `git commit --no-edit` that concludes a merge.

When a hook fails, follow the git-commit skill's diagnostics, with one exception: skip its `git pull --rebase`, and on a PR branch merge `origin/main` instead (next section).

## Conflicts

Run `git fetch origin`, then `git merge --no-commit --no-ff origin/main` in the PR's worktree.
- Never merge local `main`, or an `origin/main` fetched before the latest merge into `main`: both are stale.
- Never rebase a pushed branch.
- `--no-commit` makes even a clean merge go through the pre-commit hook.
- Conclude the merge with `git commit --no-edit`.

Resolve each hunk so **both** sides' intent survives. A conflict is two changes that both wanted to land, not a choice between them.

If another writer has already merged main, `git merge-base --is-ancestor origin/main origin/<branch>` succeeds. In that case drop your merge with `git reset --hard origin/<branch>` in the detached worktree, and add only what their resolution is missing.

| File | Do |
|---|---|
| pnpm's lockfile | Leave the markers and run `pnpm install`. If that fails, take main's side with `git checkout --theirs pnpm-lock.yaml`, run `pnpm install`, then `git add` the lockfile. |
| Visual baseline images | [Regenerate them](../e2e-testing/SKILL.md#regenerating-baselines). Binary files cannot be merged. |
| Two intents that genuinely exclude each other | Hand it over with both options stated. |

Before merging, post each resolution and its reason as a PR comment. The squash body is built from the PR's non-merge commits, so a note in the merge commit's message never reaches `main`.

Resolve conflicts after merging the PRs that are already ready, because each merge can make another PR `DIRTY`.

## Infrastructure PRs

CLAUDE.md's [check-infra section](../../../CLAUDE.md#verify-infrastructure-changes-with-pnpm-check-infra) lists what counts as infrastructure. A merge deploys staging and then prod with no reviewer, so the preview is the last point to catch a problem.

Before merging such a PR:
1. In its worktree, merge `origin/main` into the branch. A branch that is behind `main` shows `main`'s newer resources as deletes. Push that merge only if the PR is `DIRTY`.
2. Preview every stack the PR touches.
3. Record the head SHA you previewed. If the readiness read's `SHA` differs, preview again.

**Staging:** run `. ./.envrc && pnpm nx run <project>:check-infra`.
- A fresh worktree has no git-ignored `.env`, so link the main checkout's.
- Drift from placeholder values that `main`'s own preview also shows is not the PR's.

**Prod.** Run it without asking. The owner approved every prod preview on 2026-11-26, because a preview only reads. The approval covers the preview only: a `pulumi up` or any other write to prod still needs the owner.
- Nx loads `.env` and silently fills staging values, so run from a worktree with no `.env`.
- Run `PULUMI_STACK=prod AWS_PROFILE=hutch-production AWS_REGION=ap-southeast-2 PULUMI_BACKEND_URL=s3://hutch-pulumi-state-<account>-ap-southeast-2 pnpm nx run <project>:check-infra`.
- `<account>` is the account that `aws sts get-caller-identity --profile hutch-production` reports.
- Read each secret the program requires **by name** from the deployed Lambda whose environment sets that name: `aws lambda get-function-configuration --profile hutch-production --region ap-southeast-2 --function-name <fn> --query 'Environment.Variables.<NAME>' --output text`. Store it in a shell variable, and refuse it if it is empty or `None` (`[ -n "$V" ] && [ "$V" != None ]`). Export it only into the preview's process.
- `ADMIN_TOTP_SECRETS` is not on any Lambda. It lives in the SSM SecureString `admin-totp-secrets`, wrapped as `{"entries": …}`.
- A variable the PR adds is deployed nowhere yet. Use a placeholder for it and expect the diff it causes.
- Send the preview's output to a file outside the repo.

**Both stacks:**
- Confirm the stack on the preview's first line, for example `Previewing update (staging)`.
- Judge the diff by CLAUDE.md's rule: no unexpected replace, delete or drift.
- Also judge it by the rules that CLAUDE.md and the [mcp skill](../mcp/SKILL.md) place on specific resources: a KMS key, an own dead-letter queue, `ANALYTICS_SALT`, the OAuth table. Follow a guard's refusal message as written; never work around it.
- A preview that passes only because you supplied a variable locally can still fail the deploy. Check every new required variable with `gh secret list` (repository), `gh secret list --env staging` and `gh secret list --env prod`. It must be in the repository list, or in both environments.
- Merge an infrastructure PR only after `main`'s newest run has finished green. Then merge nothing else until its deploy reaches prod, so that a failure has one cause.
- Never print a secret, never run with `set -x`, and never paste diff lines that carry a secret.

**Stack outputs:** a PR that reads a stack output an earlier PR adds (check with `gh pr diff "$N" --repo "$R" | grep --extended-regexp '^\+.*(requireOutput\(|getOutput\(|pulumi stack output )'`) waits. Merge the PR that adds the output, watch it reach prod, then merge the reader.

## Merge

Run this block in one Bash call, or from a script file with `bash <file>`. Do not run it inside `bash -c '…'`: its quoting breaks.

```bash
OUT=<a scratch directory outside the repo>
: "${R:?}" "${N:?}" "${SHA:?}" "${OUT:?}" \
&& gh api "repos/$R/pulls/$N/commits" --paginate \
  --jq '.[] | select(.parents | length == 1) | .commit.message | @json' > "$OUT/$N-commits.jsonl" \
&& python3 -I -c '
import json, re, sys
TRAILER = re.compile(r"^\s*co-authored-by:", re.I)
out = []
for raw in sys.stdin:
    lines = [l for l in json.loads(raw).splitlines() if not TRAILER.match(l)]
    if not lines or not lines[0].strip():
        continue
    body = "\n".join(lines[1:]).strip()
    out.append("* " + lines[0] + ("\n\n" + body if body else ""))
assert out, "no commit messages read"
text = re.sub(r"\n{3,}", "\n\n", "\n\n".join(out))
assert not any(TRAILER.match(l) for l in text.splitlines())
print(text)' < "$OUT/$N-commits.jsonl" > "$OUT/$N-merge-body.md" \
&& TITLE=$(gh pr view "$N" --repo "$R" --json title --jq .title) \
&& printf '%s\n' "$TITLE" | grep --quiet --extended-regexp '^[a-z]+(\([^)]+\))?!?: ' \
&& gh pr merge "$N" --repo "$R" --squash --delete-branch \
     --match-head-commit "$SHA" --subject "$TITLE (#$N)" --body-file "$OUT/$N-merge-body.md"
```

| Part | Why |
|---|---|
| `: "${R:?}" …` | An unset variable stops the chain instead of merging the wrong PR or skipping the head check. |
| Strip every `Co-authored-by` trailer, matched case-insensitively | This is the owner's standing instruction, and trailers arrive in several casings. |
| `&&` between every step | A failed step must stop the merge, not land an empty or partial body. |
| `select(.parents \| length == 1)` | It drops merge-from-`main` commits, whose messages are not the PR's change. |
| One JSON string per line | `--paginate` with an array filter emits one array per page, which a single parse rejects. |
| The title check | `main`'s subjects are Conventional Commits followed by ` (#N)`. If the check stops the chain, run `gh pr edit --title` and run the block again. |
| `$SHA` comes from the readiness read and is never re-read here | Re-reading would make `--match-head-commit` compare the head with itself. |

Then confirm the landed message has no trailer. This prints `true`:

```bash
: "${R:?}" "${N:?}" \
&& M=$(gh pr view "$N" --repo "$R" --json mergeCommit --jq .mergeCommit.oid) && : "${M:?}" \
&& gh api "repos/$R/commits/$M" --jq '[.commit.message | split("\n")[] | test("^\\s*co-authored-by:"; "i")] | any | not'
```

If it prints anything else, tell the owner. Never rewrite `main`'s history to fix a landed message: that breaks every clone and deploy that has it.

## After merging

Merge the next ready PR without waiting for `main`'s CI on the previous one. Serialising on `main` multiplies the wall-clock time by the number of PRs. The exceptions are infrastructure PRs and stack-output readers ([above](#infrastructure-prs)).

Before the first merge, and before each later one, read the newest finished run on `main`:

```bash
gh run list --repo "$R" --workflow ci.yml --branch main --event push --limit 30 \
  --json databaseId,status,conclusion,headSha \
  --jq '[.[] | select(.status == "completed" and .conclusion != "cancelled")][0]'
```

`main` is red when that run's conclusion is `failure` and the failing job is `web-tests`, `perf-tests` or a `deploy-*` job. Stop merging while `main` is red. A failure only in a store-publish job (TestFlight, Play, the extensions) is reported, but it does not stop merging.

`main`'s CI keeps one running run and one pending run. After a burst of merges, the runs in between end `cancelled`. That is expected, and the surviving run deploys all the merged changes together. Follow the newest run through to prod from pass to pass, and do not block a pass on it, because a blocked pass leaves every other PR waiting. The git-commit skill's post-push watch says what to check. If the run you are following ends `cancelled`, list the runs again and follow the newest.

### When main fails

This applies to a failure in `web-tests`, in a deploy, or in a publish job.

1. Name the failing jobs with `gh run view <id> --repo "$R" --json jobs --jq '.jobs[] | select(.conclusion=="failure") | {name, databaseId}'`.
2. Find the **first** error:
   ```bash
   gh run view --job <job-id> --repo "$R" --log | cut -f3- \
     | grep --line-number --after-context=2 --extended-regexp '(^|[^A-Za-z:"])[Ee]rror( TS[0-9]+| \[[A-Z_]+\])?:|##\[error\]|Failed tasks:' \
     | cut -c1-300 | head -40
   ```
   Read every match. The last error is usually just the exit code. Pulumi prints a wrapper line first and the real exception in its Diagnostics block. nx names the failed task under `Failed tasks:`.
3. The candidates are every commit since the last green run, not just the PRs you merged.
   - Run `git fetch origin main`.
   - The `detect-projects` job log prints its base and head: `gh run view --job <detect-projects job id> --repo "$R" --log | grep --extended-regexp --only-matching ' (Base|Head) [0-9a-f]{40}.*'`.
   - Narrow the commits with `git log --first-parent <base>..<head> -- <the failing project's directory>`.
   - A merge that only added config can break a limit that another merge had already nearly reached.
4. Reproduce the failure locally before changing code: a test, a measured size, or a preview. Then fix it on `main`, with a test that would have caught it.
5. Re-run a failed run only if it belongs to the newest commit on `main` and nothing is pending behind it: `gh run rerun <id> --failed`. Never re-run an older run, for four reasons:
   - The refusal of an older run fires only in `deploy-staging`, after 23 or more minutes of tests.
   - The refusal counts cancelled runs.
   - `deploy-prod` and the publish jobs have no such guard.
   - The re-run queues ahead of the pending run.

   Push the fix instead. A failed run can leave other projects already deployed to prod, so check which jobs ran before assuming nothing shipped.

## Hand over

Hand a PR over when the next step is the owner's. That includes:
- a dashboard click (Stripe, App Store Connect, Play Console);
- a sign-in;
- a product decision;
- a fork;
- a guard's refusal;
- a second failed fix.

To hand over:
1. Add the `needs-manual-intervention` label.
2. Post a comment with `gh pr comment "$N" --repo "$R" --body-file <file>`. Name the blocker and the exact action the owner must take.
3. Move on.

| Rule | Why |
|---|---|
| The comment never contains the string `@claude`, not even in backticks | The listener matches the substring, so it would start a bot run on the branch. |
| Comments and labels state counts only, never IPs, emails or reader data | PR text is public. |
| Remove the label and re-enter the flow when the owner says the blocker is resolved, or when the action is visibly done | The label means "waiting on the owner", not "never merge". |

## End of a pass

A pass ends when every PR in the [candidate listing](#scope) is merged, handed over, left as a draft or a stacked PR, or waiting on something still running. Then report, and schedule the next pass as [the loop](#the-loop) says.

Report what changed since the previous pass. The first pass also names each PR it is waiting on, and what for.
- each merged PR's squash SHA, its trailer check, anything you pushed to it, and why;
- each handed-over PR's blocker, the owner's action, and the comment link;
- each PR newly left as stacked, or newly reported as still running, and why;
- the newest `main` run's outcome when it changes: deployed, still running, red (with the failing job), or held for approval.

A pass that changed nothing reports nothing beyond its wakeup's reason, and marks the wakeup a no-op, so a long quiet watch stays short in the owner's terminal.

## Boundaries

| Rule | Why |
|---|---|
| Never switch the active `gh` account. If one command needs a specific user, run `T="$(gh auth token --user <login>)" && GH_TOKEN="$T" gh …`. | Switching changes the account for every session on the machine. An unknown login yields an empty token, and `gh` then silently runs as the active account unless the `&&` stops it. |
| Approve only held CI runs of same-repo branches ([Held runs](#held-runs)). Never approve a PR review, a fork's run, or a branch-protection bypass. | A fork's run uses the fork's workflow file, which can target the self-hosted runners. |
| Never type credentials into a browser. | Sign-ins are the owner's. |
| Never use `--no-verify` without the owner's approval. | CLAUDE.md. |

In zsh, `for x in $list` does not word-split, so run multi-line loops under `bash`, from a script file.
