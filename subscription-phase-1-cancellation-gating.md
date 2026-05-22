# Phase 1 — Cancellation Gating + Stripe Webhook

> Assumes Phase 0 has shipped: the `subscription_providers` table exists
> and is populated on new Stripe checkouts.

## Why

We sold a paid product. When a paying user cancels, Stripe's standard
contract is "keep paid access until the period ends, then deactivate."
Phase 1 makes that contract real:

1. The Stripe webhook tells us when the billing period actually ends.
2. The row flips to `status='cancelled'`.
3. Write access disappears; read + export survive forever.

We never lose the user's data — they paid for it, they own it. Read access
and export must always remain available. This builds trust and creates a
clean offboarding ramp + frictionless resume path (delivered fully in
Phase 3).

Founding members (users with no `subscription_providers` row) are
grandfathered: they get full access forever, regardless of subscription
state. They predate the paid model. The original task asked for a backfill
script setting `type = 'FOUNDING_MEMBER' | 'REGULAR_USER'`. After
clarification with the user, no `type` field exists and no script is
needed: the implicit model (row absent = founding member; row present +
status = derives access) handles every case naturally.

## Access model — derived state

```
findSubscription(userId):
  row = subscription_providers.get(userId)
  if !row:                                 return { tier: 'founding',    access: 'full' }
  if row.status == 'active':               return { tier: 'paid',        access: 'full' }
  if row.status == 'pending_cancellation': return { tier: 'paid',        access: 'full' }
  if row.status == 'cancelled':            return { tier: 'paid',        access: 'read-only' }
```

`pending_cancellation` keeps full access — the user paid through the
period; we honour it. Only at the period-end webhook do we flip to read-
only.

Read-only means:

- Can view saved articles (`GET /queue`, `GET /view/:id`)
- Can export data (`GET /export`, `POST /export/start`)
- Can resume subscription (`POST /account/resume` — Phase 3)
- Cannot save new articles (`POST /queue/save`)
- Cannot use the browser-extension save endpoint
- Cannot import (`POST /import/*`)

## Design

### Files to add

| File | Purpose |
| --- | --- |
| `projects/hutch/src/runtime/domain/access/effective-access.ts` | Pure function `initGetEffectiveAccess({ findSubscriptionByUserId }) => (userId) => Promise<{ tier, access }>`. No I/O of its own — fully unit-testable. |
| `projects/hutch/src/runtime/domain/access/effective-access.test.ts` | Unit tests for all four states. |
| `projects/hutch/src/runtime/web/middleware/require-write-access.middleware.ts` | Express middleware. Loads access for `req.userId`; if read-only, returns 402 with HTML for browser routes or 402 JSON for the extension OAuth route. |
| `projects/hutch/src/runtime/web/middleware/require-write-access.middleware.test.ts` | Integration test using supertest against a minimal app. |
| `projects/hutch/src/runtime/web/pages/webhooks/stripe-webhook.page.ts` | `POST /webhooks/stripe`. Verifies signature using `STRIPE_WEBHOOK_SECRET`. Handles `customer.subscription.deleted` → `subscriptionProviders.markCancelled({ subscriptionId })`. Idempotent — re-deliveries are no-ops. Returns 400 on signature failure with error-level logging — an invalid signature means the request is not from Stripe and must be rejected. |
| `projects/hutch/src/runtime/web/pages/webhooks/stripe-webhook.route.test.ts` | Integration tests: valid signature + known event → row updated; valid signature + unknown event type → 200 no-op; invalid signature → 400; redelivery of same event → idempotent. |

### Files to modify

| File | Change |
| --- | --- |
| `projects/hutch/src/runtime/server.ts` | (a) Wire `requireWriteAccess` onto each write route group: `POST /queue/save`, `POST /import/*`, the extension OAuth save endpoint. Do NOT apply to `GET /queue`, `GET /view`, `GET /export`, `POST /export/start`, `GET /account`, `POST /account/*`, or the webhook route. (b) Mount `POST /webhooks/stripe` BEFORE the JSON body parser middleware so the raw body is available for signature verification — use `express.raw({ type: 'application/json' })` scoped to this route. |
| `projects/hutch/src/runtime/web/pages/queue/queue.page.ts` and `queue.component.ts` / template | When the view model carries `access: 'read-only'`, render a banner above the save bar: "Your subscription is cancelled. Your saved articles are still here. [Resume subscription] [Export your data]." Reuse the existing email-verification banner pattern (`banner-state.ts`). |
| `projects/hutch/src/infra/index.ts` | Add `STRIPE_WEBHOOK_SECRET: requireEnv("STRIPE_WEBHOOK_SECRET")` to the Lambda `environment:` block. |
| `.github/workflows/project-deployment.yaml` (or whichever workflow deploys hutch) | Forward `STRIPE_WEBHOOK_SECRET` into both `deploy-staging` and `deploy-prod` jobs: `STRIPE_WEBHOOK_SECRET: ${{ secrets.STRIPE_WEBHOOK_SECRET }}`. This is the most commonly missed step per the infrastructure-design skill, Flavor B. |
| Local `.envrc` / `.env` | Add `STRIPE_WEBHOOK_SECRET` for local dev with Stripe CLI's `stripe listen --forward-to localhost:.../webhooks/stripe`. |

### Stripe webhook setup (operational, not code)

Owner must, in the Stripe dashboard:

1. Create a webhook endpoint pointing at `https://<host>/webhooks/stripe`.
2. Subscribe to events: `customer.subscription.deleted` (and
   `customer.subscription.updated` if we later want to detect external
   cancellations — Phase 1 doesn't require it).
3. Copy the signing secret into the repo's GitHub Actions secrets
   (`STRIPE_WEBHOOK_SECRET`) for both staging and prod environments.
4. Verify both secrets are visible via
   `gh secret list --env staging --repo <org>/<repo>` and the prod
   equivalent.

Per the infrastructure-design skill, document this in the secret's
deployment workflow alongside the existing `STRIPE_SECRET_KEY` setup.

### Per web skill compliance

- The read-only banner is unconditionally rendered as part of the queue
  page; visibility is toggled via a state class
  (`.queue-banner--cancelled`), never via `querySelector(...).toBeNull()`
  checks in tests (see test-driven-design skill, "Never Rely on
  `querySelector(...).toBeNull()`").
- The save form remains in the DOM in read-only mode but is disabled and
  paired with the banner. Submitting it still 402s server-side — defense
  in depth, never trust the client.

### Per test-driven-design skill compliance

- `initGetEffectiveAccess` uses partial application (`init*` prefix,
  returns the effective access function).
- No mocks: the middleware test injects a fake
  `findSubscriptionByUserId` via the existing dependency-injection
  pattern.
- Stripe webhook signature verification uses the official
  `stripe.webhooks.constructEvent(rawBody, signature, secret)` helper;
  tests use Stripe's test signature generator (see Stripe's official docs
  for the helper).

## Architecture snapshot

No new `defineCommand` / `defineEvent` declarations — the webhook is a
synchronous request/response Lambda fronted by Express (the allowed
exception in the infrastructure-design skill). Snapshot not required.

If future work moves this onto SQS for retry semantics, add a snapshot at
that point.

## Tests

- Unit: `effective-access.test.ts` covers all four states (founding,
  active, pending_cancellation, cancelled).
- Integration: middleware returns 402 on write routes for cancelled
  users, 200 for active / pending_cancellation / founding.
- Integration: `GET /queue` renders the read-only banner with the
  correct state class when `status='cancelled'`.
- Integration: webhook flow — `customer.subscription.deleted` with a
  valid signature flips the row to `status='cancelled'`; second
  delivery is a no-op; bad signature → 400.
- E2E (`e2e/`): a cancelled user logs in, sees the banner; attempting
  to save shows the same banner state — no save persisted.

## Verification

1. `pnpm nx test hutch` — green.
2. Local: use `stripe listen --forward-to localhost:3000/webhooks/stripe`
   to relay test events. Trigger a `customer.subscription.deleted` and
   confirm the local DynamoDB row flips to `status='cancelled'`.
3. Local: as that user, attempt to save a link → see the banner and
   the 402 response.
4. Manually flip back to `active` in DynamoDB Local → save works again.
5. Sign up a brand-new user (no row in `subscription_providers` because
   you skipped checkout) — observe full access (founding-member path).
