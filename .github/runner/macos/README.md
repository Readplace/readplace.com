# macOS runner: visual review

[visual-review.yml](../../workflows/visual-review.yml) reads the transition frames a CI run left on the host and asks a local Qwen3-VL model whether any frame is structurally broken. It runs on the macOS self-hosted runner, outside any container, because inference needs Metal — a containerised model server silently falls back to CPU and is too slow to be useful.

Two shape constraints, both learned the hard way:

- **It is its own workflow file, not a job in ci.yml.** A job added there was held by GitHub's [malicious-workflow detector](https://github.blog/changelog/2026-07-28-github-actions-holds-potentially-malicious-workflows-for-approval/), which holds the *entire run* — `web-tests` and the deploy chain never started, so two commits landed on main with no CI. Approval requires an authenticated web session, so nobody can clear it from a script. A separate file keeps that blast radius off the critical path.
- **Evidence arrives by bind mount, not over the network.** The runner container is deliberately firewalled off from the Mac, so it cannot call a host model server. It writes under `/frames/<run id>` (the `CI_ARTIFACT_ROOT` container env in [docker-compose.yml](../gha-runner/docker-compose.yml)), which is `~/ci-frames/<run id>` on the host: `frames/` for the transition capture and `playwright/<project>/` for the screenshots and traces Playwright writes when a test fails. Keying by run id matters because reviews for concurrent runs overlap and the reviewer consumes the directory it reads — a fixed path let one run's review report on another run's frames.

That routing is also what lets the Playwright evidence be uploaded at all: it has to leave the ephemeral container, and adding an upload step to `ci.yml` is not available (see above).

The review is advisory and must stay that way until its false-positive rate is known: a missing model, a timeout, an unparseable reply, or absent frames all log and exit 0. It writes to the job summary and holds no `GITHUB_TOKEN`.

## Host setup (one-time)

```sh
.github/runner/macos/setup-vlm.sh
```

Creates `~/.readplace-ci/vlm-venv`, installs `mlx-vlm`, downloads the model (~18 GB), and creates `~/ci-frames`. The review runs with `HF_HUB_OFFLINE=1` so CI can never trigger a model download over the satellite link; to change models, run the script with the new model id, then update `VLM_MODEL` in the workflow.

## Retention and cache replay

The reviewer deletes the frames directory once it has reported, keeping only what a model flagged. Cleanup lives in the script because an `rm -rf` in a `run:` block is exactly the kind of pattern that gets a workflow held. Per-run directories under `~/ci-frames` are otherwise left alone; a green run leaves an empty shell, and a failed one leaves its screenshots.

A fully nx-cache-replayed `pnpm check` writes no frames, and the review then reports none were captured. That is correct: identical inputs were already reviewed when the cache entry was created.

## Cost

Each model call is a fresh `mlx_vlm.generate` process, so every call reloads the 18 GB of weights: ~10 s for a single-image verification, ~25–40 s for a multi-frame review pass. Every reported finding costs one verification call, because the 4-bit model invents cross-frame defects when handed a sequence and only holds up under single-frame questioning. If latency becomes the bottleneck, the fix is a resident `mlx_vlm.server` the script talks to over HTTP instead of spawning per call.

## Rollout

The runner stack boots from a separate deploy checkout (`~/Git/hutch-app`). Pull there and restart with `docker compose up -d` from `.github/runner/gha-runner/` — but only while the runner is idle: `EPHEMERAL=true` means a restart mid-job fails that job.

Treat `~/ci-frames` as job-writable data, nothing more: the review parses PNGs from it and never executes its contents.
