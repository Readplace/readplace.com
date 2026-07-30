# macOS runner: visual review

The `visual-review` job in [ci.yml](../../workflows/ci.yml) runs on the macOS self-hosted runner, outside any container, because vision-model inference needs Metal — a containerised model server silently falls back to CPU and is too slow to be useful. It reads the transition frames the `web-tests` job wrote to `~/ci-frames/<run id>` (through the `~/ci-frames:/frames` bind mount in [docker-compose.yml](../gha-runner/docker-compose.yml)), reviews them with a local Qwen3-VL model via `mlx_vlm`, and publishes findings to the job summary, plus a PR comment when a pull request has findings.

The review is advisory and must stay that way until its false-positive rate is known: every failure mode — model not downloaded, timeout, unparseable reply, missing frames — logs and exits 0.

## Host setup (one-time)

```sh
.github/runner/macos/setup-vlm.sh
```

Creates `~/.readplace-ci/vlm-venv`, installs `mlx-vlm`, downloads the model (~18 GB), and creates `~/ci-frames`. The review job runs with `HF_HUB_OFFLINE=1` so CI can never trigger a model download over the satellite link; to change models, run the script with the new model id, then update `VLM_MODEL` in ci.yml.

## Retention and cache replay

Frames are per-run disposable data: the reviewer deletes the run's directory once it has reported. Cleanup lives in the script rather than a workflow step because a `rm -rf` in a `run:` block — like any `${{ }}` expression interpolated into a shell — trips GitHub's malicious-workflow detector, which blocks the entire run (every job, not just this one) pending manual approval. Runs whose review never happens leave their directory behind at roughly 400 KB each; `~/ci-frames` is unmanaged beyond that, so check it if disk ever gets tight.

A fully nx-cache-replayed `pnpm check` writes no frames — the review then reports none were captured, which is correct: identical inputs were already reviewed when the cache entry was created.

## Cost

Each model call is a fresh `mlx_vlm.generate` process, so every call reloads the 18 GB of weights: ~10 s for a single-image verification, ~25–40 s for a multi-frame review pass. One flow with a handful of findings runs a couple of minutes. If that becomes the bottleneck, the fix is a resident `mlx_vlm.server` the script talks to over HTTP instead of spawning per call.

## Rollout

The runner stack runs from a separate deploy checkout. After pulling a compose change there, restart it with `docker compose up -d` from `.github/runner/gha-runner/`.

Treat `~/ci-frames` as job-writable data, nothing more: the review job parses PNGs from it and never executes its contents.
