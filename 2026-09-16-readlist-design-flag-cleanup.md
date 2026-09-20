# Retiring the `?feature=design` toggle on `/queue`

Written 2026-09-16, the day the toggle landed. This is the checklist for the day the
toggle goes away — either because the design becomes the only `/queue` (**promote**)
or because it is dropped (**retire**). Every file the toggle touches is listed here so
nothing has to be rediscovered from `git log`.

Precedents for both directions: `39d77eec6` promoted `feature=queues` (deleted the
flag plumbing, removed the rail-less baselines, regenerated the rest);
`f35102a08` retired `feature=my` (deleted the whole module and its plumbing).

## What the toggle does today

`GET /queue?feature=design` renders `ReadlistDesignPage` instead of `ReadlistPage`.
The selection happens once, in the router
(`projects/hutch/src/runtime/web/pages/readlist/readlist.page.ts`, `renderReadlistListing`).
Everything else the flag does is "keep the flag on every `/queue`-internal link and
redirect" plus "answer the card poll and the counts fragment in the design markup":

| Concern | Flag-off path (unchanged) | Flag-on path |
|---|---|---|
| Page | `readlist.component.ts` + `readlist.template.html` + `readlist.styles.css` | `design/readlist-design.component.ts` + `.template.html` + `.styles.css` |
| Rail | `readlist-nav.component.ts` / `.template.html` (inline rename, hover delete) | `design/readlist-design-nav.component.ts` / `.template.html` (kebab menu → Edit modal / Delete) |
| Card | `readlist-card/readlist-card.component.ts` / `.template.html` | `design/readlist-design-card.component.ts` / `.template.html` — same thumbnail (`open-article-thumbnail`) and `data-test-read-status` marker as classic, laid out as `__body` > `__main` + thumbnail |
| Counts fragment (`GET /queue/counts`) | `readlist-counts.component.ts` / `.template.html` | `design/readlist-design-counts.component.ts` / `.template.html` (also fills "N Saved Articles", "Showing N of M", numbered pages) |
| Setup guide | `onboarding/onboarding.component.ts` (founder intro, first outstanding step only) | `onboarding/onboarding-design.component.ts` / `.template.html` / `.styles.css` (right-rail card, progress %, all steps as a stepper) |
| Subscription banner | inline `aside.readlist-banner` in `readlist.template.html` | `design/readlist-design-subscription.component.ts` / `.template.html` (right-rail card, countdown tiles) |
| Rename | `readlist-rename.client.ts` (inline contenteditable) | `design/readlist-design-rename.component.ts` (modal) + `design/readlist-design.client.ts` (fetch + reload; also closes kebab menus) |
| Alerts | `p.readlist__error-flash` with `readlist.error.ts` messages | `design/readlist-design-alerts.ts` (title + body per `queue_error` code) |
| Theme | follows the account's appearance | follows the account's appearance |

Behaviour is deliberately identical under both paths (same routes, same redirects,
same confirm dialogs, same additive readlist membership, same save-tip trigger). Only
the representation differs.

## Files the toggle owns (delete or promote as a unit)

Design module — `projects/hutch/src/runtime/web/pages/readlist/design/`:

- `readlist-design-feature.ts` (+ `.test.ts`) — `readlistDesignEnabled`, `designFeatureParams`, `designFeatureParamsFrom`, `withDesignFeature`, `readlistDesignReturnQuery`
- `readlist-design.component.ts` (+ `.test.ts`), `readlist-design.template.html`, `readlist-design.styles.css`, `readlist-design.styles.ts`
- `readlist-design-nav.component.ts` (+ `.test.ts`), `readlist-design-nav.template.html`
- `readlist-design-card.component.ts` (+ `.test.ts`), `readlist-design-card.template.html`
- `readlist-design-counts.component.ts` (+ `.test.ts`), `readlist-design-counts.template.html`
- `readlist-design-subscription.component.ts` (+ `.test.ts`), `readlist-design-subscription.template.html`
- `readlist-design-rename.component.ts` (+ `.test.ts`)
- `readlist-design-alerts.ts` (+ `.test.ts`)
- `readlist-design.client.ts` (+ `.test.ts`) — bundled by the entry in `projects/hutch/scripts/build-client-bundles.js` (`readlist-design.client.js`)

Setup guide — `projects/hutch/src/runtime/web/onboarding/`:

- `onboarding-design.component.ts` (+ `.test.ts`), `onboarding-design.template.html`, `onboarding-design.styles.css`, `onboarding-design.styles.ts`
- `onboarding.types.ts` → `OnboardingStep.chip?` and `onboarding.steps.ts` → the `chip` on `save-enough-for-next-read` (only the design template reads it)

Tests and fixtures:

- `projects/hutch/src/runtime/web/pages/readlist/readlist.design.route.test.ts` — the flag's route tests (link propagation, redirects, fragments, states)
- `projects/hutch/src/runtime/web/pages/readlist/readlist.rendering-parity.route.test.ts` — one
  `describe.each` row per rendering over the shared `data-test-*` hooks (read status, pagination,
  both confirm panels, the counts out-of-band contract, the `swap=card` fallback, card polling,
  save skeleton). Neither direction deletes the file: drop the row that no longer exists
  (retire → the `design` row, promote → the `classic` row) and the `mainSelector` of the survivor
- `projects/hutch/src/runtime/cta-tracking.route.test.ts` — `MEMBER_PATHS` carries
  `/queue?feature=design` and `/queue?tab=done&feature=design`; drop both on retire, and on promote
  fold them into the plain `/queue` entries
- `projects/hutch/src/e2e/readlist-design-visual.e2e-local.ts` + `readlist-design.browser.ts` + `readlist-design-visual.e2e-local.ts-snapshots/` — the `readlist-design-*` baselines
- `projects/hutch/src/e2e/e2e-server.main.ts` → `POST /e2e/seed-subscription-state` and `projects/hutch/src/e2e/seed-subscription-state.e2e-local.ts` — added for the subscription-card baselines; independent of the flag, keep them

Shared additions the flag was the first consumer of (keep in either direction unless
nothing else uses them by then):

- `src/packages/ui-icons/src/ui-icons.ts` — `book`, `chevron-up`, `circle`, `clock`, `ellipsis`, `ellipsis-vertical`, `eye`, `file-down`, `folder`, `globe`, `loader`, `trash`, `x-circle` (`book`, `file-down` are also used by the site header)
- `projects/hutch/src/runtime/web/shared/illustrations/illustrations.ts` (+ `.test.ts`) — `book-lightbulb`, `trash-can`
- `src/packages/web-shell/src/shared/confirm-popover/` — `ConfirmPopover.illustrationHtml` + `.confirm-popover--illustrated`
- `src/packages/web-shell/src/base.styles.ts` + `BRAND_GUIDELINES.md` — `--color-secondary-text` (navy ink that follows the page; only the design card's site glyph consumes it)
- `projects/hutch/src/runtime/web/pages/readlist/readlist.viewmodel.ts` — `SubscriptionBannerState` (`trial-countdown`) carries `remaining: TrialRemaining`
- `projects/hutch/src/runtime/web/pages/readlist/readlist.url.ts` — `buildReadlistCountsUrl(state, extraParams)`
- `projects/hutch/src/runtime/web/pages/readlist/readlist-mutation-fragments.ts` — `renderReadlistMutationFragment({ extraParams })`
- `projects/hutch/src/runtime/web/pages/readlist/readlist-card/delete-confirm.component.ts` and `readlist-delete-confirm.component.ts` — `illustrationHtml?` passthrough
- `projects/hutch/src/runtime/web/shared/reader-open/reader-open.client.ts` — `CARD_SELECTOR` also matches `.readlist-design-card`

Router hooks in `readlist.page.ts` (grep for `designFeatureParamsFrom(` and
`readlistDesignEnabled(`): the page selection in `renderReadlistListing`; the card-swap
fragment `extraParams`; the out-of-bounds page clamp; `GET /counts`; `POST
/dismiss-onboarding`; `POST /onboarding/email/done`; the three `POST /save` redirects;
the two `POST /queues` redirects; the two `POST /queues/:slug/delete` redirects; `GET
/:id/card`; `POST /:id/status`; `POST /:id/delete`; and the HTML branch of `POST
/queues/:slug/rename` (a browser form post gets a 303 back to the readlist, or to
`queue_error=rename_<reason>` which `readlist-design-alerts.ts` titles — the JSON
branch the in-page rename clients use is unchanged and stays after promotion).

## Promote: make the design the only `/queue`

Work through this in order; each step keeps `pnpm check` green.

1. **Collapse the selection.** In `renderReadlistListing` call `ReadlistDesignPage`
   unconditionally and delete the `ReadlistPage` branch. In `GET /counts` and `GET
   /:id/card` keep only the design renderer. Delete every `designFeatureParamsFrom(...)`
   spread in the router — the flag no longer has to ride redirects — and delete
   `extraParams` from the card-swap `renderReadlistMutationFragment` call.
2. **Drop the flag from the links.** In the `design/` components replace
   `buildReadlistUrl(state, designFeatureParams(true))` with `buildReadlistUrl(state)`,
   `readlistDesignReturnQuery(state)` with `readlistReturnQuery(state)`, and remove every
   `withDesignFeature(...)` wrapper (card poll URL, status/delete/confirm URLs, counts
   trigger, undo URL, new-readlist action, pagination). Then delete
   `readlist-design-feature.ts` and its test.
3. **Rename the design module into place.** Move `design/*` up one level and drop the
   `-design` infix in file names, exports and BEM blocks
   (`readlist-design-card` → `readlist-article`, `readlist-design-nav` → `readlist-nav`,
   `setup-guide` can stay). Delete the old page files they replace:
   `readlist.template.html`, `readlist.styles.css`, `readlist.styles.ts` (the design page imports
   `READLIST_STYLES` wholesale, so first move what it still renders: the in-flight dots, the whole
   `.readlist-save-skeleton*` block, which dresses the shared save-skeleton partial, and the
   `.readlist__save-btn*` rules — the design save form still carries those classes and its
   `hx-disabled-elt` still names `.readlist__save-btn`), `readlist-nav.component.ts` +
   `.template.html` + `.test.ts`, `readlist-card/readlist-card.component.ts` +
   `.template.html` + `.test.ts`, `readlist-counts.component.ts` + `.template.html` +
   `.test.ts`, `readlist-filters.component.ts` + `.template.html` + `.test.ts` (the design
   page builds its own tabs), `readlist-rename.client.ts` + `.test.ts` and its
   `build-client-bundles.js` entry, `readlist.component.ts` (move `ReadlistRailViewModel`
   and `readlistDeleteConfirmPanels` callers first), `onboarding/onboarding.component.ts`
   + `.template.html` + `.styles.css` + `.styles.ts` + `.test.ts`. Update
   `reader-open.client.ts` `CARD_SELECTOR` to the single surviving class.
4. **Light pin already removed.** Dark mode for the design page shipped, so
   `pinnedAppearance: "light"` and the whole `PageBody.pinnedAppearance` seam
   (`page-body.types.ts`, `base.component.ts`, its shell test) are already gone — nothing to do here.
5. **Route tests.** Fold `readlist.design.route.test.ts` into the existing
   `readlist.*.route.test.ts` files: drop the "carries feature=design" assertions, keep
   the state assertions (alerts, empty states, subscription card, counts fragment, card
   markup), and delete the `withDesignFeature(path)` helper. Update the old route tests
   that select `.readlist-article`, `.readlist-nav__*`, `.readlist__save-form`,
   `.readlist__filters`, `.readlist__sort`, `.readlist__pagination`, `.onboarding`,
   `[data-test-subscription-banner]` copy, and the `Page N of M` counts fragment to the
   design selectors and copy. `data-test-*` hooks were kept identical wherever the
   element still exists, so most tests only need selector edits.
6. **Baselines.** Delete the 34 old `/queue` checkpoints and their PNGs
   (`readlist-nav-visual` rail/page/editing/tab-skeleton names, `readlist-save-skeleton-visual`,
   `onboarding-visual`, `eink-greyscale-visual` readlist captures, `mark-status-confirm-visual`,
   the `readlist-empty` / `readlist-pagination-page-1` checkpoints in
   `readlist-flow/visual-checkpoints.ts`, and the `readlist-preferences-visual` captures
   if `feature=pref` is retired too). Rename the `readlist-design-*` checkpoints to plain
   names (a rename changes the PNG file name, so run the baseline target). Then run
   `pnpm nx run hutch:update-visual-baselines` (macOS + Docker) and commit darwin and
   linux together.
7. **Mobile.** The design page linear-stacks below 1024px but was never captured on a
   phone. Add phone checkpoints (390×844 and the 320px no-sideways-overflow check that
   `readlist-nav-visual` used to run) before this becomes the only page.
8. **Housekeeping.** `pnpm check` runs knip and the unused-CSS check: delete now-unused
   exports (`preferencesFeatureParams` stays only if `feature=pref` survives) and the
   `purgecss-ignore` blocks that no longer guard anything. Update the `/queue` references
   in `CLAUDE.md` ("Product Constraints") if the save bar's location moved for the
   reader.

## Retire: drop the design

1. Delete the design module directory, the `onboarding-design.*` files, the `chip` field
   on `OnboardingStep` and its `onboarding.steps.ts` entry, the `readlist-design.client`
   entry in `build-client-bundles.js`, `readlist.design.route.test.ts`,
   `readlist-design-visual.e2e-local.ts` and its snapshots directory.
2. In `readlist.page.ts` remove the imports and every hook listed above; the router then
   reads exactly as before the flag.
3. Revert `reader-open.client.ts` `CARD_SELECTOR` to `.readlist-article`. The design-side
   save-skeleton siblings go with the design stylesheet — `readlist.styles.css` keeps only its own
   `.readlist__empty` / `.readlist__list` halves, so nothing to unpick there.
4. Decide per shared addition whether anything else uses it: the icons used by the
   header (`book`, `file-down`) and the `illustrationHtml` seam are
   harmless to keep; `renderIllustration`, the unused icons, the `--color-secondary-text`
   token, `remaining` on the trial
   banner state, and the `extraParams` parameters become knip/coverage failures and
   should go.
5. `pnpm check`; no baselines change because the flag-off page never changed.

## Not part of the toggle

The site-wide header restyle (centred icon nav, user menu with initials + email, navy
verify/changelog bars) shipped in its own commit before the flag and is not gated. Its
footprint: `src/packages/web-shell/src/{nav.template.ts,nav.component.ts,user-initials.ts,
banner-state.ts,base.component.ts,base.styles.ts,changelog-banner.ts}`,
`FindUserByIdResult.email` in `src/packages/provider-contracts/src/auth.ts` and its
producers, and `projects/hutch/src/runtime/web/banner-state.ts`.
