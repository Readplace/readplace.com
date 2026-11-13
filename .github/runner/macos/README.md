# macOS runner: visual review

[visual-review.yml](../../workflows/visual-review.yml) reads the transition frames a CI run left on the host and asks a local Qwen3-VL model whether any frame is structurally broken. It runs on the macOS self-hosted runner, outside any container, because inference needs Metal — a containerised model server silently falls back to CPU and is too slow to be useful.

Two shape constraints, both learned the hard way:

- **It is its own workflow file, not a job in ci.yml.** A job added there was held by GitHub's [malicious-workflow detector](https://github.blog/changelog/2026-07-28-github-actions-holds-potentially-malicious-workflows-for-approval/), which holds the *entire run* — `web-tests` and the deploy chain never started, so two commits landed on main with no CI. Approval requires an authenticated web session, so nobody can clear it from a script. A separate file keeps that blast radius off the critical path.
- **Evidence arrives by bind mount, not over the network.** The runner container is deliberately firewalled off from the Mac, so it cannot call a host model server. It writes under `/frames/<run id>` (the `CI_ARTIFACT_ROOT` container env in [docker-compose.yml](../gha-runner/docker-compose.yml)), which is `~/ci-frames/<run id>` on the host: `frames/` for the transition capture and `playwright/<project>/` for the screenshots and traces Playwright writes when a test fails. Keying by run id matters because reviews for concurrent runs overlap and the reviewer consumes the directory it reads — a fixed path let one run's review report on another run's frames.

That routing is also what lets the Playwright evidence be uploaded at all: it has to leave the ephemeral container, and adding an upload step to `ci.yml` is not available (see above).

A review that does not verify its frames fails its run: a missing model, a timeout, an unparseable reply, absent frames (bar the re-run exception under [Retention and cache replay](#retention-and-cache-replay)), or a defect the model confirms on a single frame all end red, because a green review is read as "frames checked" (see the [e2e-testing skill](../../../.claude/skills/e2e-testing/SKILL.md#never-let-a-failed-or-unrun-visual-check-leave-ci-green)). It writes to the job summary, and its token can only post that verdict as a `Visual Review` commit status on the commit the CI run tested — the run itself attaches to the default branch, so without the status a pull request would never see it.

## Host setup (one-time)

```sh
.github/runner/macos/setup-vlm.sh
```

Creates `~/.readplace-ci/vlm-venv`, installs `mlx-vlm`, downloads the model (~18 GB), and creates `~/ci-frames`. The review runs with `HF_HUB_OFFLINE=1` so CI can never trigger a model download over the satellite link; to change models, run the script with the new model id, then update `VLM_MODEL` in the workflow.

## Retention and cache replay

The reviewer deletes the frames directory once it has reported, keeping what a model flagged for the artifact and, after a clean review, the controls described at the end of this section. Cleanup lives in the script because an `rm -rf` in a `run:` block is exactly the kind of pattern that gets a workflow held. Per-run directories under `~/ci-frames` are otherwise left alone; a green run leaves the record described next, and a failed one leaves its screenshots.

A clean review leaves `frames-reviewed-clean.md` in the run directory, and a later review of the same run id that finds no `frames/` passes on it. Re-running a CI run's failed jobs without `web-tests` completes a new attempt that delivers nothing: review 37263003791 went red on `ENOENT` after review 37261610917 had passed and consumed the frames. Any `frames/` delivered since, even an empty one, discards the record and gets a full review, and frames that changed while a review ran leave no record, so the next review fails rather than passing on frames nobody read.

A fully nx-cache-replayed `pnpm check` runs no e2e, so it has to deliver the frames its original run captured; a run that delivers none fails the review rather than being assumed already checked.

A review that finds neither `frames/` nor the record fails with a message that names the directory it looked for, the CI run id and why the frames are gone, in place of a bare `ENOENT`. A re-run of the review alone never finds frames: every review deletes the frames it read, and only a clean one leaves the record. On a first attempt the CI attempt that triggered the review handed nothing over: a run GitHub held for approval completes as `action_required` with no job run and still triggers a review, or the run's failed jobs were re-run without `web-tests` after an earlier review had consumed the frames without leaving the record. The remedy the message gives is the same for all of them: re-run the CI run with all its jobs — approve it in the browser if it is held — or push a new commit.

A clean review that read every delivered frame also copies each flow's frames to `~/.readplace-ci/clean-controls/<flow>/<CI run id>/` before deleting them, and keeps only the newest controls of each flow by the time of the copy — the count is the constant in the review script beside the string `clean-controls`. The controls sit outside `~/ci-frames` on purpose: CI jobs can write there, and the review deletes old controls by listing their directory, so a link a job planted in a job-writable location could aim that deletion at another directory on this Mac. A failed review copies nothing: its frames go to the artifact. A copy that fails ends the review red with the frames left in place, so re-running the review reads them again; flows copied before the failure keep their control. Only a review run by GitHub Actions copies (`GITHUB_ACTIONS` is `true`): a local replay runs the wording under test, so its clean verdict is not evidence that the frames pass. The controls are the must-pass side of a change to the prompts, which twice could not be measured on real passing captures because every review had deleted its frames: the claim that failed commit c4f5227 had been rejected on at least five earlier captures, and the wording that fixed it, measured on one valid set, then confirmed the "folder" claim under [The verification prompt](#the-verification-prompt) from review 40166362047 to review 42022272486 (2026-10-25 to 2026-11-05).

To replay a flow's controls, copy about a dozen of its run directories into a scratch `frames/` directory. Copy them; never point `FRAMES_DIR` at the controls, because the review deletes the directory it reads. Each run id is then reviewed as its own flow and must review clean. A dozen take about three minutes at the per-call times under [Cost](#cost), and a CI run created after the replay starts has put its review on this Mac in seven (CI run 38146055843, review 38146514777), so replay in batches and only under the conditions in [One model server per host](#one-model-server-per-host). A clean review is the model's verdict, not proof that the frames are correct, so look at the frame of a control that fails before blaming the wording. The two extension flows repeated byte for byte in every capture from 2026-10-24 to 2026-11-11 (CI runs 39108290144 to 43001180195), so one control of each is enough; the readlist-save flow is where captures differ. The controls are copies of job-written frames: nothing uploads them and nothing executes them.

## Cost

The review starts one resident `mlx_vlm.server` per job and sends every call to it over HTTP, so the 18 GB of weights load once per job instead of once per call — the per-call reload is where the intermittent `Command failed` kills of a fresh `mlx_vlm.generate` process died on a contended host. Once loaded, a multi-frame review pass takes ~9 s and a single-image verification ~1–2 s. Every reported finding costs one verification call, because the 4-bit model invents cross-frame defects when handed a sequence and only holds up under single-frame questioning.

Each verification also leaves one line in the job log — `verify ` followed by a JSON object with the flow, the claim, its verdict (`confirmed`, `rejected` or `unanswered`) and the raw reply — because a rejected claim is otherwise invisible: the blurred-banner claim that review 40077996187 confirmed had been made and rejected on at least five green reviews before it, and only token counts in the model server's log showed that afterwards. The claim text is model output over job-writable frames, so it goes to the job log alone, not to the step summary and not to the clean-review record, which a frameless re-run republishes as its summary.

That verification confirms whatever the claim names that is literally visible, so the defect list may only name states a screenshot can tell apart from a correct page. "Overlays covering interactive controls" could not: an open modal dialog over its scrim is exactly that, so once the readlist's save flow opened an "Add link" dialog (commit 386d973b8) the class confirmed the dialog on every capture that held it: review 38713178625, and 12 of 12 local runs over frames captured at that commit and at the one before, whose own two reviews had passed on frames nobody kept. Without the class the same frames reviewed clean on every run, as did the extension popup flows, and a leaked `undefined` was still confirmed on every frame it appeared in. Do not bring an overlay class back.

## The verification prompt

The verification prompt defines clipping as an edge cutting through the letters of text, and it says the blur and dimming of the page behind an open modal dialog are intentional while the dialog itself is still judged. Without that, the verifier confirmed blurred text as clipped. Review 40077996187 failed commit c4f5227 on the readlist-save flow: with the "Add link" dialog open, the reviewer claimed the blurred verify banner was "cut off on the right side". The old prompt confirmed that claim on that capture's frame 0 in 10 of 10 replays and on frames 1–4 in 0 of 10 each, and had confirmed the same claim ten minutes earlier on the capture behind review 40077354710 (commit 4c68b70), whose frames were not kept. By token signature the first pass had made the same claim on five earlier green reviews, and on the two other captures of the flow that survived (CI runs 40085107369 and 40105680807) the old prompt confirmed it on frame 0 10/10 on each and rejected it on frames 1–4 0/10 on each; a full old-prompt review of them ended green 5/5 on both, because their first pass worded the frame-0 claim differently ("cut off at the end" of the dialog text) and the old prompt rejected that wording 0/10 while confirming the original wording 10/10 on the same frame.

The wording is fragile, so measure any change before shipping it. The 4-bit model only just confirmed genuine clipping under the old prompt. A first stricter definition ("visible glyphs cut off … complete text that is blurred is not clipped") rejected the false positive, but it also rejected both genuine clipping claims as the reviewer words them, in 20 of 20 replays. The shipped wording came from measuring about 250 variants. Its sentence order (definition, claim, dialog rule, question) and its plain "visible" rather than "clearly visible" are what keep genuine clipping confirmed.

The sentence saying that text with empty space after its last character is complete came from the readlist-save flow. The reviewer kept claiming that "folder" is cut off at the end of the verify banner, although "spam folder." renders in full with about 240 px of banner to its right. Without the sentence the verifier confirmed 16 of 103 such claims, and the review failed for all 4 CI frame sets measured and 6 of 16 local captures. Shortening the page's email address did not help: the claim came back on 7 of 8 captures in which the address was fully visible. A related wording ("text that stops short of the edge, leaving a gap") made it worse, at 29 of 103, and a sentence placed after the claim rejected genuine clipping in the banner.

Known gaps:
- These need a precisely worded claim to be confirmed: a vaguely worded clip inside the dialog, and template text such as `undefined` on the page behind an open dialog. The old prompt missed the first too, but it caught the second.
- Overlapping elements, and text clipped at a container's bottom edge, are rejected under both prompts.

None of these changes a review outcome today, because the reviewer never reports those defects. The verify reply must be exactly `true` or `false`. Any other reply fails the review, because the old `/true/i` match also counted "not true" as a confirmation.

### Replaying the fixtures

[fixtures/](fixtures) holds the frames of the CI run behind review 40077996187 (`valid-frames-from-false-positive-run-40076890263`, which must review clean) and four flows rendered from the real app with a planted defect (`genuine-defects`, each of which must fail). To replay a set, copy it to a scratch `frames/` directory, because the reviewer deletes what it reads. Then run `review-frames.mjs` with `FRAMES_DIR`, `VLM_MODEL`, `VLM_PYTHON` and `REVIEW_RUN_URL` set as in the workflow. Measured with the prompt before the empty-space sentence, 20 runs per set:

| Set | Expected | Result |
|---|---|---|
| valid frames from run 40076890263 | clean | 20/20 clean |
| clipped banner, no dialog | fails | 20/20 failed |
| clipped text inside the open dialog | fails | 20/20 failed |
| `undefined` in the banner, no dialog | fails | 20/20 failed |
| `undefined` in the open dialog's title | fails | 20/20 failed |

Under the first stricter definition, both clipping sets reviewed clean 20/20.

With the shipped prompt, two full replays gave the same verdict on every set in that table, and the two later captures of the same flows (CI runs 40085107369 and 40105680807) reviewed clean 20/20 each. A single replay of 20 readlist-save frame sets (16 local captures and 4 from CI) rejected all 88 claims.

Frame 0 of the readlist-save flow differs in every capture — the port and timestamp in the link field, the worker index in the username, whether the field shows a focus ring — while frames 1–4 can repeat byte for byte (runs 40076890263 and 40085107369 share them). The first-pass claims and the frame-0 verdict follow those pixels: under the old prompt the original claim was confirmed 10/10 on frame 0 of all three captures and rejected 0/10 on frames 1–4, while full reviews of the two later captures stayed green 5/5 because their first pass worded the claim differently. 20/20 on one valid set is therefore 20/20 on that capture, not on the flow; measure a wording change on every valid set, including the clean controls CI keeps (see [Retention and cache replay](#retention-and-cache-replay)). The two captures are kept outside the repository with the measurements.

The valid set needed 21 runs to get 20 verdicts. One run hung: the model server produced no token for 600 s and timed out, because a CI-triggered review loaded a second copy of the model at the same time. Replay only while both self-hosted runners are idle (`gh api repos/{owner}/{repo}/actions/runners`). Two resident servers on one machine can starve each other.

The model remains a heuristic: these numbers measure repeatability on known frames, not a guarantee. The text-fit assertions in hutch's `verify-banner-nav-visual.e2e-local.ts` cover deterministically that the banner's text fits its box and the viewport, on desktop and mobile, light and dark, and with the dialog open and closed.

A review that fails keeps its frames as evidence: confirmed defects, an unparseable review, or a verification that answered neither true nor false. Before this, the upload step was skipped whenever the review step failed, so review 40077996187 kept no evidence.

## One model server per host

The reviewer refuses to start while a process running `python -m mlx_vlm.server` is up: it fails within seconds, names each such process (PID and command line) in the job log, and leaves the frames on disk, so re-running the review from the Actions UI once that process is gone reviews them. A review that gives up on loading its own server stops that server before it fails, so a timed-out review leaves no second copy behind. Two resident copies of the model have stalled together: review 40108828635 attempt 1 began 3 s after a local fixture replay had started its server and loaded its own copy 15 s later; from then on neither produced another token, and the job ran into its 10-minute limit — reported by the API as `cancelled` — instead of ending with the cause. Attempt 3 passed twelve hours later on the frames the first two had left in place.

The check matches the interpreter and its `-m` argument, not the text alone, because a shell whose command merely mentions the server is not a server: review 42022272486 was refused over a local shell waiting on `pgrep -f mlx_vlm.server`.

It is a refusal, not a wait or a lock: a `concurrency:` group cannot see a local process, and a review that waited would spend its job budget on someone else's replay. The reverse therefore holds too: any local `mlx_vlm.server` — a fixture replay, a prompt harness, a stub — fails the CI review that arrives while it runs. Start one only while both self-hosted runners are idle and no CI or Visual Review run is queued or in progress (`gh api repos/{owner}/{repo}/actions/runners`; `gh run list --workflow ci.yml --status in_progress`, `--status queued`, and the same for `visual-review.yml`), and after `pgrep -fl mlx_vlm.server` finds nothing. Do not re-run a CI run or a Visual Review from the Actions UI while a local server runs: a re-run of a single CI job completed in 1.4 minutes and its review loaded the model 1.8 minutes after the re-run started (run 38394552205, attempt 2). A review this refusal failed is re-run after the local server has exited.

## Rollout

The runner stack boots from a separate deploy checkout (`~/Git/hutch-app`). Pull there and restart with `docker compose up -d` from `.github/runner/gha-runner/` — but only while the runner is idle: `EPHEMERAL=true` means a restart mid-job fails that job.

Treat `~/ci-frames` as job-writable data, nothing more: the review parses PNGs from it and never executes its contents.
