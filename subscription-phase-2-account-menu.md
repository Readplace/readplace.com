# Phase 2 — Account Menu for Subscription Management

> Assumes Phases 0 and 1 have shipped: the table exists, access gating
> works, the webhook reacts to Stripe.

## Why

The user has no surface inside the app today to act on their subscription.
A logged-in user can't see their plan, can't cancel, can't resume. We need
this inside the app for two reasons:

1. Lower support load — users self-serve instead of emailing us.
2. Control the framing — we own the cancellation copy (delivered in
   Phase 3). If we redirected to the Stripe Billing Portal we'd lose the
   chance to soften the moment with "your data is still here, you can
   resume any time with no new card."

## Re the question about pausing instead of cancelling

The user's words are **cancel** — the in-app button says "Cancel
subscription." The Stripe primitive is `cancel_at_period_end: true`.
This is Stripe's standard "graceful cancellation" pattern:

- The subscription stays active until the current period ends
  (`current_period_end`, typically ~30 days away).
- During that window the user keeps full paid access (we honour
  `status='pending_cancellation'` as full-access in Phase 1).
- At period end, Stripe fires `customer.subscription.deleted` — handled
  by the Phase 1 webhook, which flips the row to `cancelled`.
- The user can clear the cancellation flag at any time before period end
  with a single click — Phase 3 handles "resume before period end."

The "resume after period end" path (Phase 3) creates a NEW subscription
on the same customer using their saved payment method — no checkout UI,
one click — exactly the "no additional credit card required" behaviour
requested. The old subscription remains `canceled` in Stripe forever.

## Design

### Files to add

| File | Purpose |
| --- | --- |
| `projects/hutch/src/runtime/web/pages/account/account.page.ts` | Page handler. `GET /account` renders summary; `POST /account/cancel` calls Stripe `subscriptions.update(id, { cancel_at_period_end: true })` + flips row to `pending_cancellation`. (Resume = Phase 3.) |
| `projects/hutch/src/runtime/web/pages/account/account.component.ts` | Component assembly. |
| `projects/hutch/src/runtime/web/pages/account/account.template.html` | Template with four branches: founding-member, active, pending_cancellation, cancelled. (Cancelled state is a thin Phase 2 placeholder; Phase 3 fleshes it out.) |
| `projects/hutch/src/runtime/web/pages/account/account.view-model.ts` | View-model builder. |
| `projects/hutch/src/runtime/web/pages/account/account.styles.ts` | BEM-scoped styles (`.account-card`, `.account-card__status`, etc.). |
| `projects/hutch/src/runtime/web/pages/account/account.url.ts` | URL builder. |
| `projects/hutch/src/runtime/web/pages/account/account.route.test.ts` | Integration tests for all four states + cancel action. |
| `projects/hutch/src/runtime/providers/stripe-subscriptions/stripe-subscriptions.ts` | New thin wrapper: `initStripeSubscriptions({ stripeClient }) => { scheduleCancellation, clearCancellation, createSubscription, retrieveSubscription }`. Mirrors the shape of `stripe-checkout.ts`. |
| `projects/hutch/src/runtime/providers/stripe-subscriptions/stripe-subscriptions.test.ts` | Unit test with a fake Stripe client asserting exact API payloads. |

### Files to modify

| File | Change |
| --- | --- |
| `projects/hutch/src/runtime/web/header.template.html` | Add `<li><a href="/account">Account</a></li>` in the logged-in branch, immediately before the Sign-out form (line 9-14 region). |
| `projects/hutch/src/runtime/server.ts` | Mount `/account` routes behind `requireAuth` only (NOT `requireWriteAccess` — cancelled users must still reach `/account` to resume). |

### Page behaviour by state

| State | Page renders (Phase 2 — minimal; Phase 3 finalises copy) |
| --- | --- |
| Founding member (no row) | "You're a founding member." Static, no buttons. |
| Active (`status='active'`) | "Subscription: Active." Button: **Cancel subscription** → `POST /account/cancel`. |
| Pending cancellation (`status='pending_cancellation'`) | "Subscription: Active until `<cancellationEffectiveAt>`. Cancelled — won't renew." Button: **Keep subscription** → `POST /account/resume` (Phase 3). |
| Cancelled (`status='cancelled'`) | "Subscription: Cancelled." Button: **Resume subscription** → `POST /account/resume` (Phase 3 wires both paths). |

The Phase 2 deliverable is the Cancel button + the state-aware page. Phase 3
adds the confirmation step, the final copy, and the Resume button.

### `POST /account/cancel` handler

1. Load `req.userId`'s subscription row.
2. If absent → 400 ("nothing to cancel" — founding members shouldn't reach
   this route).
3. If `status !== 'active'` → redirect 303 to `/account` (idempotent).
4. Call `stripeSubscriptions.scheduleCancellation({ subscriptionId })` —
   wraps `stripe.subscriptions.update(id, { cancel_at_period_end: true })`.
   Capture `result.current_period_end` from the response.
5. `subscriptionProviders.markPendingCancellation({ userId, cancellationEffectiveAt: new Date(current_period_end * 1000).toISOString() })`.
6. Redirect 303 to `/account`.

### Per web skill compliance

- All actions are HTML `<form method="POST">` first.
- The nav and the forms get `hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none"` for SPA feel.
- No custom `*.client.js`.
- POST-Redirect-GET for state changes.

## Architecture snapshot

No new commands/events. The Stripe call is synchronous request-scoped,
fronted by Express. Snapshot not required.

## Tests

- Unit: `stripe-subscriptions.test.ts` asserts the exact
  `subscriptions.update` payload (`{ cancel_at_period_end: true }`).
- Integration: `account.route.test.ts` covers GET for all four states +
  POST `/cancel` transitioning active → pending_cancellation, with
  `cancellationEffectiveAt` correctly captured from the (faked) Stripe
  response.
- Integration: nav link renders for logged-in users (extend
  `header.template` tests).

## Verification

1. `pnpm nx test hutch` — green.
2. Local: log in as the (manually-seeded) active paid user → visit
   `/account` → click **Cancel** → observe redirect to `/account` showing
   "Active until `<date>`" state → confirm Stripe dashboard shows the
   subscription with `cancel_at_period_end: true`.
3. Per Phase 1 verification: even after cancel scheduled, save still
   works until the webhook flips status to `cancelled`.
