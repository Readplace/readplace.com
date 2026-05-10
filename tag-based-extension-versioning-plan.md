# Plan: Migrate browser extension versioning from commit-based to git-tag-based

**Status:** proposed (not yet implemented)
**Owner:** to be picked up in a fresh session — this document is self-contained, no prior conversation context required
**Estimated scope:** 2 publish workflows, 2 build-extension scripts, 2 bump-version scripts (delete), 2 build-extension configs, 1 CI workflow cleanup. ~6–8 files total.
**Prerequisite:** the temporary `NX_BASE = github.event.before` workaround in `.github/workflows/ci.yml` is in place and working. This plan removes it once tag-based versioning is live.

---

## 1. Why this exists — background

### The loop we already broke (and how)

Until commit `f2a99af3` (PR #249), `chrome-extension` and `firefox-extension` declared `"hutch": "workspace:*"` in `devDependencies`. The Nx graph treated devDeps as edges, so every change to `projects/hutch/**` (including unrelated web/page CSS edits) caused `nx affected --target=compile` to flag the extensions. The CI publish gate in `.github/workflows/ci.yml` (search for `chrome-affected` / `ff-affected`) then fired the publish workflows for both extensions on every hutch change, generating chains of `chore: bump * extension version to X.Y.Z` commits on `main`.

Phase 3 (commit `f2a99af3`) cut the package-json edge: extensions now spawn hutch's e2e server as a subprocess via `pnpm nx run hutch:e2e-server` and use `POST /e2e/users` over HTTP to seed test fixtures. With the graph edge gone, `nx affected --target=compile` returns `["hutch"]` for any hutch-only change.

### The loop we patched but didn't break

Even after Phase 3, CI was still republishing extensions on hutch-only changes. The reason was the publish workflows themselves:

- `publish-chrome-extension.yml` runs `bump-version.js patch`, which mutates `chrome-extension/package.json` and `chrome-extension/src/runtime/manifest.json`, then commits and pushes to main with `GITHUB_TOKEN`.
- `submit-ff-extension-for-signing.yml` does the same for firefox.
- GitHub deliberately does **not** trigger workflows for `GITHUB_TOKEN`-pushed commits (loop prevention), so those bot commits have no CI run associated with them.
- `nrwl/nx-set-shas@v4` (the original `NX_BASE` setter) defaulted to "last successful workflow run." With bot commits invisible to that lookup, the next human push's `NX_BASE` walked back past every bot bump to the previous human-triggered CI commit.
- The diff therefore included every bot version-bump commit. `package.json` and `manifest.json` are production inputs for the extensions, so `nx affected --target=compile` flagged the extensions as affected — purely because of the bot commits, not the human change.
- Publish gate fired → publishes ran → more bumps → next human push includes those → loop continues.

Commit `cde38d67` patched this by replacing `nrwl/nx-set-shas@v4` with `NX_BASE = ${{ github.event.before }}` in `ci.yml`. That gives the diff of the *current push* only, regardless of bot commits in between. Combined with the install-deps guard in commit `f0eabe4c`, hutch-only pushes now correctly skip extension publishes (verified on CI run `25616593254`).

### Why the patch isn't the right end state

The patch is a workaround for a structural problem: **the publish workflow encodes its output as new commits on the source branch.** That makes the extension `version` field a moving target tracked in git, with all the consequences:

- Every publish creates a commit; `git log` becomes noisy with `chore: bump * extension version to X.Y.Z`
- Every bot push is an artifact of a previous publish, but it still touches files Nx sees as "production inputs" for the extensions
- The CI workflow has special-case logic (`NX_BASE = github.event.before`) to compensate, which skips the more useful default of "compare against last green main"
- Forking, rebasing, or cherry-picking near a publish becomes confusing
- Loop avoidance depends on a GitHub default (`GITHUB_TOKEN` doesn't trigger workflows) that could quietly change in the future

Tag-based versioning removes the cause: the source tree has a single placeholder version, the publish process tags the commit it published from, and the next version is computed from the latest tag at publish time. Source files don't churn, the workaround in `ci.yml` becomes unnecessary, and the publish flow has the same structural shape as conventional release tooling (semantic-release, release-please, etc.).

---

## 2. Goal — what success looks like

After this plan lands:

- `projects/extensions/chrome-extension/package.json` and `chrome-extension/src/runtime/manifest.json` always contain a placeholder version (e.g., `"0.0.0-managed-by-tag"`). They are never edited by automation.
- Same for `projects/extensions/firefox-extension/{package.json,src/runtime/manifest.json}`.
- `chrome-extension/scripts/bump-version.js` and `chrome-extension/src/bump-version.ts` are **deleted**. Same for firefox.
- `publish-chrome-extension.yml` and `submit-ff-extension-for-signing.yml`:
  1. Read the latest git tag matching `chrome-extension@vX.Y.Z` (or `firefox-extension@vX.Y.Z`)
  2. Compute the next version with `semver.inc(latest, 'patch')`
  3. Inject the version into the build via env var (e.g., `EXTENSION_VERSION=1.0.129 node scripts/build-extension.js`); `build-extension.js` writes the version into the bundled output without ever mutating the source files
  4. Submit to the Chrome Web Store / AMO using that injected version
  5. On success, create and push the tag (`git tag chrome-extension@v1.0.129 && git push origin chrome-extension@v1.0.129`). Tags don't trigger the `ci.yml` push handler.
  6. **No `git commit` step. No `git push origin main`.**
- `.github/workflows/ci.yml`: the `Set NX_BASE / NX_HEAD to this push's exact range` step is replaced (or reverted) so that `NX_BASE` uses `nrwl/nx-set-shas@v4` again — the original "last successful run" semantics. Source files no longer churn from bot commits, so the action's default is correct again.
- The `chore: bump * extension version` history in `git log` stops growing. Existing commits stay untouched.

---

## 3. Pre-flight reading (do this first)

Before changing anything, read these files in order. They contain the relevant logic and conventions:

1. `.github/workflows/publish-chrome-extension.yml` — the chrome publish flow. Pay attention to the `Bump extension version`, `Build and package extension`, `Commit and push bumped version to main`, and `Submit to Chrome Web Store` steps.
2. `.github/workflows/submit-ff-extension-for-signing.yml` — same shape for firefox; submission goes through `web-ext sign` instead of the Chrome Web Store API.
3. `projects/extensions/chrome-extension/scripts/build-extension.js` — what `node scripts/build-extension.js` actually does. The script reads `process.env.HUTCH_SERVER_URL` and stamps it into the bundled extension (via `browser-extension-core/build`'s `initBuildExtension` / `createBuildPlan`). The version comes from `package.json`.
4. `projects/extensions/firefox-extension/scripts/build-extension.js` — same shape.
5. `projects/extensions/chrome-extension/build-extension.config.js` and `firefox-extension/build-extension.config.js` — config consumed by `createBuildPlan`. Inspect to confirm where the version is injected into the bundle and `manifest.json` of the *output* (not the source).
6. `projects/extensions/chrome-extension/src/bump-version.ts` — the existing bump logic. Reading it will be useful even though you're about to delete it: it shows where in the file tree `version` currently flows.
7. `.github/workflows/ci.yml`, the step labelled `Set NX_BASE / NX_HEAD to this push's exact range` — the workaround you'll be removing. The comment block above it has the full rationale.
8. `projects/browser-extension-core/src/build/` (path may vary — find with `grep -rn "createBuildPlan" projects/browser-extension-core`) — confirm whether `createBuildPlan` accepts an explicit version override, or whether you need to add one.
9. `git log --oneline --grep "bump.*extension version" | head -20` — eyeball the historical commit cadence so you know roughly how many tags will exist after backfill.

---

## 4. Concrete change set

Each item names a file and what to do. Order doesn't matter for correctness, but the order here matches a sensible review/PR sequence.

### 4.1 Source files: pin the version to a placeholder

| File | Change |
|------|--------|
| `projects/extensions/chrome-extension/package.json` | Set `"version": "0.0.0-managed-by-tag"`. Comment in package.json isn't possible, but a sibling `// version` field would be confusing. Just commit and document elsewhere. |
| `projects/extensions/chrome-extension/src/runtime/manifest.json` | Same — `"version": "0.0.0-managed-by-tag"` (Chrome's manifest validator accepts arbitrary strings; the actual version goes in via the publish flow). |
| `projects/extensions/firefox-extension/package.json` | Same. |
| `projects/extensions/firefox-extension/src/runtime/manifest.json` | Same. |

If `0.0.0-managed-by-tag` fails validation in any consumer (e.g., extension store dev-mode), use `0.0.0` and rely on a code comment in `build-extension.config.js` to explain. Verify with a local `pnpm --filter chrome-extension compile-dev` and `pnpm --filter firefox-extension compile-dev`.

### 4.2 Build pipeline: accept version from env var, never read from package.json

| File | Change |
|------|--------|
| `projects/extensions/chrome-extension/scripts/build-extension.js` | Replace the version source: instead of `require('../package.json').version`, read `process.env.EXTENSION_VERSION` and `assert` it's a valid semver. Pass it through to `createBuildPlan` (signature change required — see next row). |
| `projects/extensions/firefox-extension/scripts/build-extension.js` | Same. |
| `projects/extensions/chrome-extension/build-extension.config.js` | If `createBuildPlan` doesn't already accept a version parameter, add one — or expose a hook for the build-extension script to override the version stamped into the output `manifest.json`. Look in `projects/browser-extension-core/src/build/` for the actual function definition. |
| `projects/browser-extension-core/src/build/<file with createBuildPlan>` | Add `version: string` to the `createBuildPlan` input. Use it in place of whatever currently reads `package.json` or `manifest.json` for the version. Add a unit test (`createBuildPlan.test.ts` should already exist next to it). |

For local dev (`pnpm --filter chrome-extension compile-dev`), default `EXTENSION_VERSION` to `0.0.0-dev` if unset. The dev workflow doesn't care about a real version.

### 4.3 Publish workflows: read latest tag, compute next, inject, tag

#### `publish-chrome-extension.yml`

Replace these steps:
- `Compile bump-version script`
- `Bump extension version`
- `Build and package extension`
- `Commit and push bumped version to main`

with this sequence:

1. **Compute next version**
   ```yaml
   - name: Compute next version from latest chrome-extension tag
     id: version
     run: |
       LATEST=$(git tag --list 'chrome-extension@v*' --sort=-v:refname | head -n1 | sed 's/^chrome-extension@v//')
       if [ -z "$LATEST" ]; then
         LATEST="0.0.0"  # bootstrap: if no prior tag, start at 0.0.0 → first publish is 0.0.1
       fi
       NEXT=$(node -e "console.log(require('semver').inc('$LATEST', 'patch'))")
       echo "version=$NEXT" >> "$GITHUB_OUTPUT"
       echo "Latest tag: chrome-extension@v$LATEST → publishing v$NEXT"
   ```
2. **Build with that version**
   ```yaml
   - name: Build and package extension
     env:
       EXTENSION_VERSION: ${{ steps.version.outputs.version }}
     run: npx nx run-many --target=compile --projects=browser-extension-core,chrome-extension
   ```
3. **Submit to Chrome Web Store** (existing step — confirm it doesn't read version from package.json again, only from the built artifact)
4. **Tag the commit**
   ```yaml
   - name: Tag the published commit
     if: success()
     run: |
       git tag "chrome-extension@v${{ steps.version.outputs.version }}"
       git push origin "chrome-extension@v${{ steps.version.outputs.version }}"
   ```

The `actions/checkout@v6` step that already runs at the top of the job needs `fetch-depth: 0` (or `fetch-tags: true` on v6+) so `git tag --list` sees the full tag history. Verify the existing checkout already has it; add if not.

The bot identity setup (`git config user.name "github-actions[bot]"` etc.) is still needed for the tag push.

#### `submit-ff-extension-for-signing.yml`

Same pattern:
- Replace `Bump extension version` + `Commit and push bumped version to main` with `Compute next version from latest firefox-extension tag` + `Tag the published commit`.
- `web-ext sign` is the equivalent of `Submit to Chrome Web Store`. Inject the version via the same `EXTENSION_VERSION` env var; `firefox-extension/scripts/build-extension.js` reads it.
- Tag namespace: `firefox-extension@vX.Y.Z` to keep chrome and firefox tags separate.

### 4.4 Delete the bump scripts and tests

| File | Action |
|------|--------|
| `projects/extensions/chrome-extension/src/bump-version.ts` | Delete. |
| `projects/extensions/chrome-extension/src/bump-version.test.ts` | Delete. |
| `projects/extensions/chrome-extension/scripts/bump-version.js` | Delete. |
| `projects/extensions/firefox-extension/src/bump-version.ts` | Delete. |
| `projects/extensions/firefox-extension/src/bump-version.test.ts` | Delete. |
| `projects/extensions/firefox-extension/scripts/bump-version.js` | Delete. |

After deletion, confirm `pnpm --filter chrome-extension lint` and `pnpm --filter firefox-extension lint` pass — knip should not flag anything (no orphaned imports, since nothing should be importing these any more).

### 4.5 Backfill tags from existing version history

The current `git log` has `chore: bump chrome extension version to 1.0.128` (and similar) commits. After this plan lands, the next publish would compute `0.0.0 → 0.0.1`, which would be a regression below the live store version `1.0.128`.

Backfill once before merging:

```bash
# For each historical bump commit, create a tag pointing at it. Adjust prefix per extension.
git log --pretty='%H %s' --grep '^chore: bump chrome extension version to' \
  | awk '{print $1, $NF}' \
  | while read sha version; do
      git tag "chrome-extension@v$version" "$sha" 2>/dev/null || true
    done
git push origin --tags
```

Repeat for firefox with `firefox extension version to`. Verify: `git tag --list 'chrome-extension@v*' --sort=-v:refname | head -3` shows `chrome-extension@v1.0.128` (or whatever is current at backfill time).

If backfill is awkward, an alternative is to seed a single starting tag by hand at the current published version, e.g. `git tag chrome-extension@v1.0.128 main && git push origin chrome-extension@v1.0.128`. Future publishes increment from there. Skipping the historical commits is fine — the tags exist for "next version" computation, not for archaeology.

### 4.6 Remove the `NX_BASE = github.event.before` workaround

Once tag-based publishing is live and verified (see test plan below), revert the workaround in `.github/workflows/ci.yml`:

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | Replace the entire `Set NX_BASE / NX_HEAD to this push's exact range` step (and its long comment block) with `- uses: nrwl/nx-set-shas@v4` and the original short comment. Leave a *brief* note in the workflow saying "previously needed to skip bot version-bump commits — no longer applicable since publish workflows tag instead of commit." |

After this, `NX_BASE` is the SHA of the last successful CI run on main. Bot commits no longer exist, so this is the correct anchor.

---

## 5. Test plan

Verify each layer in isolation before pushing the integrated change.

### 5.1 Local: build-extension accepts injected version

```bash
# Chrome
EXTENSION_VERSION=9.9.9 node projects/extensions/chrome-extension/scripts/build-extension.js
grep '"version"' projects/extensions/chrome-extension/dist-extension-compiled/manifest.json
# Expect: "version": "9.9.9"

# Source files unchanged
grep '"version"' projects/extensions/chrome-extension/package.json projects/extensions/chrome-extension/src/runtime/manifest.json
# Expect: both still show "0.0.0-managed-by-tag"
```

Repeat for firefox.

### 5.2 Local: missing env var fails loudly

```bash
unset EXTENSION_VERSION
node projects/extensions/chrome-extension/scripts/build-extension.js
# Expect: assertion error "EXTENSION_VERSION is required" (or similar — the script should not fall through silently to a default in CI mode; a dev mode default like 0.0.0-dev is fine for `compile-dev` only)
```

### 5.3 CI: dry-run on a feature branch with a fake tag

```bash
git checkout -b test-tag-publish
git tag chrome-extension@v9.9.9-rc1
git push origin chrome-extension@v9.9.9-rc1 test-tag-publish
# Open a PR; the publish workflow shouldn't fire on PRs (existing behaviour).
# To exercise the publish path itself, manually `gh workflow run publish-chrome-extension.yml --ref test-tag-publish` — confirm it computes 9.9.9-rc2, builds, submits to Chrome Web Store dev/test channel if available, and tags 9.9.9-rc2.
# Clean up: git tag -d chrome-extension@v9.9.9-rc1 chrome-extension@v9.9.9-rc2; git push origin --delete chrome-extension@v9.9.9-rc1 chrome-extension@v9.9.9-rc2
```

If the Chrome Web Store / AMO submission can't easily be exercised in a dry run, accept the smaller test: assert that the workflow runs through the build + tag steps without failure on the test branch.

### 5.4 End-to-end on main: verify the loop is broken

After merging the PR for this plan:

1. Make a hutch-only change (e.g., the same `founding-progress.styles.css` comment trick used historically).
2. Push to main.
3. Watch the resulting CI run with `gh run list --branch main --limit 1 --workflow=ci.yml` and `gh run view <id>`.
4. Confirm:
   - `detect-projects` shows `Affected projects: ["hutch"]` (or hutch + its real graph deps, but **NOT** chrome-extension or firefox-extension)
   - `chrome-extension-publish` job: **skipped**
   - `ff-extension-publish` job: **skipped**
   - No new `chore: bump * extension version` commit appears on main afterwards
   - No new `chrome-extension@vX.Y.Z` or `firefox-extension@vX.Y.Z` tag appears

5. Make a chrome-extension-only change (e.g., edit `chrome-extension/src/runtime/popup/popup.client.ts`). Push to main. Confirm the publish workflow runs and produces a new tag (`chrome-extension@v<bumped>`), but no new commit.

6. After verifying steps 4 and 5, do the workaround removal in 4.6 as a separate commit. Watch the next hutch-only push to main and confirm the gate still skips extensions with the original `nrwl/nx-set-shas@v4` action. If extensions get republished after the workaround removal, the tag-based publish flow is leaking source-file mutations somewhere — investigate before merging.

### 5.5 Acceptance: `nx affected` baseline simulation

```bash
# Pick the SHA of any successful CI run on main, before this PR
LAST_GREEN=$(gh run list --branch main --limit 1 --workflow=ci.yml --json headSha,conclusion --jq '.[] | select(.conclusion=="success") | .headSha')

# Touch a hutch web file
echo "/* probe */" >> projects/hutch/src/runtime/web/shared/founding-progress/founding-progress.styles.css
git add . && git commit -m "probe"

pnpm nx reset
pnpm nx show projects --affected --target=compile --base=$LAST_GREEN --head=HEAD --json
# Expect: ["hutch"]

# Simulate the gate
AFFECTED=$(pnpm nx show projects --affected --target=compile --base=$LAST_GREEN --head=HEAD --json)
echo "$AFFECTED" | jq -e 'index("chrome-extension")' >/dev/null && echo "chrome-affected: true" || echo "chrome-affected: false"
echo "$AFFECTED" | jq -e 'index("firefox-extension")' >/dev/null && echo "ff-affected: true" || echo "ff-affected: false"
# Expect both false.
```

Reset the working tree (`git reset --hard HEAD~1`) afterwards.

---

## 6. Risks and edge cases

- **Chrome Web Store version monotonicity.** Stores reject submissions with versions below the previously-published one. The backfill step in 4.5 prevents an accidental "go back to 0.0.1." If the backfill is skipped, the first publish after this PR will fail at submission. The seeding-by-hand alternative (single tag at the current published version) is enough to avoid this.
- **Manifest schema validation.** Some manifest validators reject `"version": "0.0.0-managed-by-tag"` because Chrome historically required `MAJOR[.MINOR[.PATCH[.BUILD]]]` numeric only. Use `"0.0.0"` if validation fails and rely on the build process to overwrite it. Test with `pnpm --filter chrome-extension compile-dev` and `pnpm --filter firefox-extension compile-dev` early.
- **Extension auto-update manifests.** Firefox uses a hosted update manifest at `https://hutch-extension-prod.s3.ap-southeast-2.amazonaws.com/updates.json` (referenced in `firefox-extension/src/runtime/manifest.json`). Confirm the `sync-signed-extension.yml` workflow that updates that manifest reads the version from the signed artifact, not from `manifest.json` source. If it reads from source, it needs the same env-var injection treatment.
- **Local dev `compile-dev` flow.** Devs run `pnpm --filter chrome-extension compile-dev` to load an unpacked extension. If the build script asserts `EXTENSION_VERSION` is set, this breaks them. Pick one: (a) default to `0.0.0-dev` when env var is missing AND `HUTCH_SERVER_URL` looks like localhost (existing dev marker per `build-extension.js:9`), or (b) require everyone to `EXTENSION_VERSION=0.0.0-dev` in their `.envrc`. Option (a) is friendlier.
- **Tag deletion / rewrites.** If a tag needs to be deleted (e.g., a botched publish), do it on both the local repo and the remote (`git push origin --delete <tag>`). The next publish will compute from the remaining latest tag.
- **First publish after this lands.** Will be the first invocation of the new workflow. Watch closely. If it fails, the source tree is unchanged (no commits to revert) — just fix the workflow and re-run.

---

## 7. Out of scope (intentionally)

- **Conventional Commits-driven version bumping** (semver release). Future enhancement: parse commit messages since the last tag to decide patch/minor/major. Not needed for the current "always patch" cadence.
- **Replacing other CI commit-back patterns** (e.g., the auto-fix workflows that commit to PRs). Those commit to PR branches, not main, and don't interact with the publish gate.
- **Migrating other workspace projects** (`hutch`, `save-link`, etc.) to tag-based versioning. They don't auto-publish to external stores; their `version` field is purely internal.
- **CI run on tag pushes.** Tags don't trigger the existing `ci.yml` workflow (its `on:` declares `push: { branches: [main] }` only). Leave it that way — we don't want a CI run per publish.

---

## 8. PR breakdown suggestion

This is one logical change but reviews more cleanly as 3 PRs:

1. **PR 1 — build pipeline accepts injected version** (4.1 + 4.2). Source pinning + `EXTENSION_VERSION` env var support. No publish workflow changes yet. CI passes. Local `compile-dev` still works.
2. **PR 2 — publish workflows compute version from tags** (4.3 + 4.4 + 4.5 backfill). The publish workflows now tag instead of commit. The `bump-version.{ts,js}` scripts go away. Verify a dry-run publish.
3. **PR 3 — remove the `NX_BASE = github.event.before` workaround** (4.6). Only after PR 2 has been live long enough that you've seen at least one extension publish complete cleanly without producing a `chore: bump` commit.

If you'd rather merge as one PR, that's also fine — the test plan in 5.4 covers the integrated check.

---

## 9. Anti-goal — what this plan does NOT change

- The Phase 3 graph decoupling (`f2a99af3`) stays. Extensions still spawn `pnpm nx run hutch:e2e-server` for e2e tests; they still don't have `hutch` in their `package.json`.
- The `install-deps` Nx target in `projects/hutch/project.json` stays (it self-heals a missing `hutch/node_modules` for local dev). The conditional guard in `f0eabe4c` is the right shape.
- Hutch's Lambda deploy chain is unchanged.
- Extension test infrastructure (`POST /e2e/users` etc.) is unchanged.

If anything in this list looks like it needs to change too, you've drifted from the goal of this plan — stop and question.
