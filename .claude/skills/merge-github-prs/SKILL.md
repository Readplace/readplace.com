---
name: merge-github-prs
description: Get open, non-draft pull requests green and squash-merged into main, or handed to the owner when only they can unblock one. Use when asked to "merge all PRs", "merge the ready PRs", "land the open PRs", "make sure all PRs are merged", "babysit the PRs", "get PR #N in", or "why is PR #N blocked"; when a PR shows `mergeStateStatus` `DIRTY`, a failing or flaky check, or a missing, stale or failed Visual Review; and when a deploy on main fails after a PR merge.
---

# Merging GitHub PRs

Asked about every PR, the goal is that each open non-draft PR is either merged into `main` as one squash commit with a clean message, or [handed over](#hand-over) with the exact action the owner must take. Asked about one PR, apply the same rules to that PR only.

`main` has no required checks or reviews, so `gh pr merge` will land a red PR: the readiness rules below are the only gate.

## Scope

| PR | Do |
|---|---|
| Draft | Leave it. A draft is its author saying "not yet" |
| Base is not `main` (stacked) | Leave it; CI runs only for PRs into `main`, so it has no checks. Merge its base first |
| From a fork (`isCrossRepository` true) | Hand over. Its code must not run on the self-hosted runners or under the AWS profiles, and Visual Review skips forks so it can never be ready |
| Carries `needs-manual-intervention`, `pending-decision` or `POC` | Hand over (or leave, if already handed over): someone has already said a human decides |
| Changes `.github/workflows` | Merge it last and tell the owner first: its push to `main` can re-arm GitHub's "may be malicious" hold, which holds every later run until they approve it in the browser ([git-commit skill](../git-commit/SKILL.md#approving-a-run-that-asks-for-approval)) |

List the candidates with the REST pulls endpoint, which pages fully and reports drafts, forks, bases and labels:

```bash
R=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
gh api --paginate "repos/$R/pulls?state=open&per_page=100" \
  --jq '.[] | select(.draft | not) | "\(.number) \(.head.repo.full_name // "deleted-fork") base=\(.base.ref) labels=\([.labels[].name] | join(","))"'
```

## When a PR is ready

```bash
gh pr view "$N" --repo "$R" --json mergeStateStatus,headRefOid,statusCheckRollup \
  --jq '{mergeStateStatus, headRefOid, checks: [.statusCheckRollup[] | {name: (.name // .context), result: (.conclusion // .state), startedAt, completedAt}]}'
```

| Condition | Why |
|---|---|
| Every check has completed and none is `FAILURE`, `CANCELLED`, `TIMED_OUT` or `ERROR`; `SKIPPED` and `NEUTRAL` are fine | `perf-tests` gates every deploy on `main`, and `ios-tests`/`android-tests` are the only tests of an app change |
| `Visual Review` is `SUCCESS` **and** its `startedAt` is later than `web-tests`' `completedAt` | It is a commit status keyed by the head SHA, so after a re-run it shows the previous attempt's verdict until the new one posts. It starts only after the whole CI run completes, so while CI runs it is absent, not pending |
| `mergeStateStatus` is not `DIRTY` or `UNKNOWN` | `UNKNOWN` is GitHub still computing, usually right after another merge; read it again |
| Save `headRefOid` from this read as `SHA` | The merge passes it to `--match-head-commit`, so a push after this read refuses the merge instead of landing unchecked code |

| Symptom | Do |
|---|---|
| `web-tests` failed on a test the diff does not touch | `gh run rerun <ci-run-id> --failed`. A second failure **in the same test** is real; first check whether `main` fails it too, and if so merge the fixed `main` into the branch rather than fixing it on the PR |
| `Visual Review` failed with a model-server timeout, stuck `PENDING` because its verdict upload failed on DNS or network, or failed with no frames because `web-tests` failed | The run id is the tail of the status's `targetUrl` (the latest review run listed is not necessarily this PR's — see the git-commit skill). Re-run that run once. For a no-frames failure, re-run the CI run with all jobs instead; the review alone cannot find frames |
| `Visual Review` rejects a real visual change | Follow the e2e-testing skill's [Regenerating Baselines](../e2e-testing/SKILL.md#regenerating-baselines), or hand over if the change looks unintended |
| A real failure | [Fix it yourself](#fix-it-yourself), at most twice per PR, then hand over |

## Fix it yourself

Fix a failing PR locally and push to its branch; do not tag `@claude`. The owner asked for local fixes: a bot round-trip costs a CI cycle and a self-hosted runner slot, and a local fix is verified before it is pushed. The repo's own workflows still tag `@claude` automatically on a failed PR CI run or a conflict, so expect another writer on the branch.

| Step | Why |
|---|---|
| `git fetch origin`, then `git worktree add --detach <dir> origin/<branch>` | Leaves the main checkout and other PRs untouched, and works while the author's session still has the branch checked out |
| `pnpm install` in the new worktree before any commit | Git's hook path is created by the install; without it a commit runs no hook and gives no warning, which is `--no-verify` by accident |
| Before pushing, `git fetch origin` again; if the branch moved (a bot or the author pushed), merge it in first | Push with a plain `git push origin HEAD:<branch>`, never a force-push; a refused push means someone else wrote, so fetch, merge and retry |
| Remove the worktree once the PR is merged | Each worktree holds a full install |

- The commit's pre-commit hook runs the check, so it is a heavy task under CLAUDE.md's [cap of fewer than three](../../../CLAUDE.md#delegated-agents-never-run-the-full-check); every push or rerun also starts `web-tests` and Visual Review on the self-hosted runners and counts against the next one.
- A delegated fix or conflict resolution runs on the model and effort CLAUDE.md's [model table](../../../CLAUDE.md#which-model-for-which-work) gives coding work, named on the call. The agent edits and runs only the failing test; this session runs every hook-firing commit, `git merge --continue` included.
- A hook failure follows the git-commit skill's diagnostics, except its `git pull --rebase`: on a PR branch merge `origin/main` instead (next section).

## Conflicts

`git merge --no-commit --no-ff origin/main` in the PR's worktree — never local `main`, which is usually stale, and never a rebase of a pushed branch. `--no-commit` makes even a clean merge go through the pre-commit hook. Resolve each hunk so **both** sides' intent survives: a conflict is two changes that both wanted to land, not a choice between them.

| File | Do |
|---|---|
| pnpm's lockfile | Take either side, then regenerate with `pnpm install` |
| Visual baseline images | [Regenerate them](../e2e-testing/SKILL.md#regenerating-baselines); binary files cannot be merged |
| Two intents that genuinely exclude each other | Hand over with both options stated |

Post each resolution and its reason as a PR comment before merging: the squash body is built from the PR's non-merge commits, so a note in the merge commit's message never reaches `main`. Resolve conflicts after merging the PRs that are already ready; each merge can make another PR `DIRTY`.

## Infrastructure PRs

Before merging a PR that touches infrastructure (CLAUDE.md's [check-infra section](../../../CLAUDE.md#verify-infrastructure-changes-with-pnpm-check-infra) lists what counts), preview every stack it touches from the PR's worktree **after** merging `origin/main` into it; a branch behind `main` shows `main`'s newer resources as deletes. A merge deploys staging then prod with no reviewer, so the preview is the last point to catch it.

- **Staging:** `pnpm check-infra` (or `pnpm nx run <project>:check-infra`). A fresh worktree has no git-ignored `.env`; link the main checkout's. Placeholder drift that `main`'s own preview also shows is not the PR's.
- **Prod:** the root command resets the stack to staging, so prod needs the project's own preview with `PULUMI_STACK=prod`, the prod `AWS_PROFILE`, and `PULUMI_BACKEND_URL=s3://hutch-pulumi-state-<account>-ap-southeast-2`, where `<account>` is what `aws sts get-caller-identity --profile hutch-production` reports. Read each secret the program requires **by name** from the deployed Lambda that already has it (`aws lambda get-function-configuration --query 'Environment.Variables.<NAME>' --output text` into a shell variable), export it only into the preview's process, and send the preview's output to a file outside the repo.
- Judge the diff by CLAUDE.md's rule — no unexpected replace, delete or drift — and by the rules CLAUDE.md and the [mcp skill](../mcp/SKILL.md) place on specific resources (a KMS key, an own dead-letter queue, `ANALYTICS_SALT`, the OAuth table). A refusal message from a guard is followed as written, not worked around.
- A preview that passes only because you supplied a variable locally can still fail the deploy: check `gh secret list --env staging` and `--env prod` for every new required variable.
- Merge infrastructure PRs one at a time and watch each deploy, so a failure has one cause.
- Never print a secret, run with `set -x`, or paste diff lines that carry one.

## Merge

```bash
OUT=<a scratch directory outside the repo>
gh api "repos/$R/pulls/$N/commits" --paginate \
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
&& gh pr merge "$N" --repo "$R" --squash --delete-branch \
     --match-head-commit "$SHA" --subject "$TITLE (#$N)" --body-file "$OUT/$N-merge-body.md"
```

| Part | Why |
|---|---|
| Strip every `Co-authored-by` trailer, matched case-insensitively | The owner's standing instruction; trailers arrive in several casings |
| `&&` between every step | A failed step must stop the merge, not land an empty or partial body |
| `select(.parents \| length == 1)` | Drops merge-from-`main` commits, whose messages are not the PR's change |
| One JSON string per line | `--paginate` with an array filter emits one array per page, which a single parse rejects |
| `$SHA` from the readiness read, never re-read here | Re-reading makes `--match-head-commit` compare the head with itself |
| Subject `<title> (#N)` | `main`'s convention. If the title is not a Conventional Commit, `gh pr edit --title` it first |

Then confirm the landed message has no trailer; this prints `true`, and prints nothing if a lookup failed:

```bash
M=$(gh pr view "$N" --repo "$R" --json mergeCommit --jq .mergeCommit.oid) \
&& gh api "repos/$R/commits/$M" --jq '.commit.message | test("^\\s*co-authored-by:"; "im") | not'
```

Anything else: tell the owner. Never rewrite `main`'s history to fix a landed message — that breaks every clone and deploy that has it.

## After merging

Merge the next ready PR without waiting for `main`'s CI on the previous one; serialising on `main` multiplies the wall-clock by the number of PRs. Infrastructure PRs are the exception (above), and so is a PR that reads a stack output an earlier PR in the batch adds: wait for that deploy first.

`main`'s CI keeps one running and one pending run, so after a burst of merges the runs in between end `cancelled` — expected, and never re-run: the surviving run deploys the union. Watch that newest run through to prod (the git-commit skill covers the watch and approving held CI runs). Stop merging while `main` is red.

When a deploy fails:

1. `gh run view <run-id> --json jobs` names the failing job; find its **first** error with `gh run view --job <job-id> --log | grep --line-number --max-count=1 --extended-regexp ' error: |##\[error\]'`. The last error is usually just the exit code.
2. The candidates are every commit since the last green run, not just your batch: the `detect-projects` job log prints its base and head, and `git log --first-parent <base>..<head> -- <the failing project's directory>` narrows them. A merge that only added config can break a limit another merge was already near.
3. Reproduce the failure locally (a test, a measured size, a preview) before changing code; then fix it on `main` with a test that would have caught it.
4. A re-run is refused once a newer commit's run has completed; push the fix instead. A failed run can leave the other projects already deployed to prod, so read which jobs ran before assuming nothing shipped.

## Hand over

When the next step is the owner's — a dashboard click (Stripe, App Store Connect, Play Console), a sign-in, a product decision, a fork, a guard's refusal, or a third failed fix — add `needs-manual-intervention` and a comment that names the blocker and the exact action the owner must take, then move on. Comments and labels state counts, never IPs, emails or reader data: PR text is public.

## Done

Done when the [candidate listing](#scope) shows no open non-draft PR that is neither merged nor handed over, and the newest `main` run has deployed or its failure is reported. Report:

- each merged PR's squash SHA and trailer check, and anything you pushed to it and why
- each handed-over PR's blocker, the owner's action and the comment link
- the deploy outcome, and anything still running

## Boundaries

| Rule | Why |
|---|---|
| Never switch the active `gh` account. If one command needs a specific user, `T="$(gh auth token --user <login>)" && GH_TOKEN="$T" gh …` | Switching changes the account for every session on the machine; an unknown login yields an empty token, and `gh` then silently runs as the active account unless the `&&` stops it |
| Approve only held CI runs of same-repo branches — never a PR review, a fork's run, or a branch-protection bypass | A fork's run uses the fork's workflow file, which can target the self-hosted runners |
| Never type credentials into a browser | Sign-ins are the owner's |
| Never `--no-verify` without the owner's approval | CLAUDE.md |

Run multi-line loops under `bash -c`: zsh does not word-split `for x in $list`.
