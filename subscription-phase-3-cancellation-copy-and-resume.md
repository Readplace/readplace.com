# Phase 3 — Cancellation Copy + One-Click Resume

> Assumes Phases 0, 1, 2 have shipped: table exists, gating works, the
> webhook reacts, `/account` renders all four states, Cancel works.

## Why

When a user clicks "Cancel subscription," two things must land
immediately:

1. **Trust** — they keep their data. They can export. Nothing is lost.
2. **Frictionless return** — resume is one click, no card re-entry. This
   is the single highest-leverage churn reducer Stripe offers.

The current Phase 2 page does the mechanics. Phase 3 wraps the mechanics
in copy that reduces fear at the moment of cancellation and removes
friction at the moment of return.

## Design

### Files to modify

| File | Change |
| --- | --- |
| `projects/hutch/src/runtime/web/pages/account/account.template.html` | Replace the bare Phase 2 buttons with the copy below. Add a confirmation step on cancel. |
| `projects/hutch/src/runtime/web/pages/account/account.page.ts` | Add `POST /account/resume` handler with two code paths: `pending_cancellation` → clear `cancel_at_period_end`; `cancelled` → create new subscription on existing customer. |
| `projects/hutch/src/runtime/web/pages/account/account.route.test.ts` | Add tests for both resume paths and for the new copy strings. |
| `projects/hutch/src/runtime/providers/stripe-subscriptions/stripe-subscriptions.ts` | Confirm `clearCancellation({ subscriptionId })` and `createSubscription({ customerId, priceId })` are present. (Phase 2 added the wrapper; Phase 3 may add the create-subscription path.) |
| `projects/hutch/src/runtime/web/pages/queue/queue.template.html` | The read-only banner (Phase 1) gets the final copy alignment: prominent **Resume** button, secondary **Export** link, "Your subscription is cancelled — your saved articles are still here" phrasing. |

### Copy

**Active state — primary screen:**

> ## Your subscription
>
> Active — billed monthly.
>
> [ Cancel subscription ]   (secondary button; navigates to confirmation step)

**Cancel confirmation step** (rendered when `?confirm=cancel` query param
is present, per the URL-as-state convention in the web skill):

> ## Cancel your subscription?
>
> Your saved articles stay exactly where they are. You'll be able to
> export your data after cancellation — visit the Export page any time.
>
> You'll keep full access until your current period ends (your next
> billing date). After that, you'll switch to read-only mode — you can
> still view and export your saved articles, but you won't be able to
> save new ones or use the browser extension.
>
> Resuming later is one click. Your card on file stays put, so you won't
> need to re-enter payment details.
>
> [ Cancel subscription ]   [ Keep my subscription ]

**Pending-cancellation state:**

> ## Your subscription will end on `<formatted cancellationEffectiveAt>`
>
> You still have full access until then. Your saved articles will stay
> available after — you'll switch to read-only mode at that point.
>
> Changed your mind?
>
> [ Resume subscription ]   (clears cancellation; same card, no checkout)

**Cancelled state:**

> ## Your subscription is cancelled
>
> Your saved articles are still here. Resume to start saving again —
> your card on file still works, no new payment method needed.
>
> [ Resume subscription ]   (creates a fresh subscription on your
> existing card — one click, no checkout)
>
> [ Export your data → ]    (link to `/export`)

### URL-as-state for the confirmation step

Per the web skill: the confirmation step is a `GET` to
`/account?confirm=cancel`, NOT a JavaScript modal. The view model branches
on `confirm === 'cancel'` and renders the confirmation copy + a
`<form method="POST" action="/account/cancel">` with `hx-boost`. "Keep my
subscription" is an `<a href="/account">` link.

This means:

- Bookmarkable.
- Works without JS.
- Back button cancels naturally.

### Resume handler

```
// POST /account/resume
1. Load subscription row for req.userId.
2. If row absent → 400 ("nothing to resume").
3. If row.status === 'active' → redirect 303 (idempotent).
4. If row.status === 'pending_cancellation':
     a. stripeSubscriptions.clearCancellation({ subscriptionId: row.subscriptionId })
        // stripe.subscriptions.update(id, { cancel_at_period_end: false })
        // Race window: if the `customer.subscription.deleted` webhook fires
        // between the row read (step 1) and this Stripe API call, the
        // subscription no longer exists in Stripe and the update throws.
        // Catch the Stripe error (resource_missing / 404) and fall through
        // to step 5 (cancelled path: create a new subscription on the
        // existing customer). This avoids surfacing a 500 to the user.
     b. subscriptionProviders.markActive({ userId })
5. If row.status === 'cancelled':
     a. created = stripeSubscriptions.createSubscription({
          customerId: row.customerId,
          priceId: requireEnv("STRIPE_PRICE_ID"),
        })
        // stripe.subscriptions.create({ customer, items: [{ price }] })
        // No payment confirmation needed — customer has a default payment
        // method from the original checkout. If the card has expired or
        // was removed, this throws and we render an error page asking
        // the user to update their card via Stripe Billing Portal (out
        // of scope for Phase 3 — caught and rendered as a friendly
        // message linking to support).
     b. subscriptionProviders.upsertActive({
          userId: row.userId,
          provider: "stripe",
          subscriptionId: created.id,
          customerId: row.customerId,
        })
        // Overwrites the row — new subscriptionId, old one is forgotten
        // in our store. Stripe keeps the old one in `canceled` state
        // forever as the historical record.
6. Redirect 303 to /account.
```

After resume, the queue page's read-only banner from Phase 1 disappears
automatically (because effective access is now full).

### Card-on-file failure mode

If `createSubscription` throws because the customer's default payment
method has expired or was removed, render an error page on `/account`
explaining "your card on file is no longer valid — contact support" with
a mailto link. We don't ship in-app card update in this phase. The Stripe
error is logged at error level for ops visibility.

### Per web skill compliance

- Confirmation is a server-rendered page state, not a JS modal.
- All buttons are inside `<form method="POST">` or `<a href>`.
- `hx-boost="true"` on the form and nav link container delivers the SPA
  feel.
- No custom `*.client.js` introduced.

## Tests

- Integration: `POST /account/resume` covers all three branches:
  `pending_cancellation` → `active` (cleared in Stripe, no new sub),
  `cancelled` → `active` (new sub created with the same customer),
  `active` → noop redirect, missing row → 400.
- Integration: `GET /account?confirm=cancel` renders the confirmation
  copy and a form posting to `/account/cancel`.
- Integration: `GET /account` for cancelled user contains both
  "Resume subscription" and an `<a href="/export">` link, asserted via
  semantic CSS classes (`.account-card__resume`,
  `.account-card__export`) per the web skill's
  no-`data-test-*`-in-CSS rule.
- Unit: `stripe-subscriptions.test.ts` covers `clearCancellation` and
  `createSubscription` payloads.
- E2E: cancelled user sees banner → clicks Resume → banner disappears
  → save works again. Verify the new `subscriptionId` in DynamoDB
  differs from the original.

## Verification

1. `pnpm nx test hutch` — green.
2. Local: as the seeded user → visit `/account` (state=active) → click
   **Cancel** → land on confirmation → click **Cancel subscription** → see
   pending-cancellation copy with the correct date → confirm Stripe
   dashboard shows `cancel_at_period_end: true`.
3. Click **Resume** (still pending) → state returns to active → Stripe
   dashboard shows `cancel_at_period_end: false`.
4. To exercise the "cancelled → resume" path: in Stripe test mode use
   `stripe trigger customer.subscription.deleted` against the
   subscription → webhook flips row to `cancelled` → click **Resume** on
   `/account` → confirm a NEW `subscriptionId` lands in DynamoDB and
   Stripe shows two subscriptions for the customer (one `canceled`,
   one `active`).
5. As a cancelled user (before clicking Resume): visit `/queue`,
   confirm banner; visit `/export` and trigger an export to confirm
   read access still works.

---

## Cross-phase notes (recap)

- **Webhook scope**: Phase 1 adds `POST /webhooks/stripe` handling
  `customer.subscription.deleted`. We may extend later to handle
  `customer.subscription.updated` (for external dashboard changes) and
  `invoice.payment_failed` (for dunning) but those are out of scope.
- **No new EventBridge commands/events.** No architecture snapshots
  required for any phase. (Webhook handler is a synchronous request/
  response Lambda fronted by Express — allowed exception.)
- **One-time manual migration** for the single existing paid user is the
  only data change to production.
- **Order is strict**: Phase 1 depends on Phase 0's table; Phase 2
  depends on the access middleware existing (so `/account` doesn't get
  gated incorrectly); Phase 3 depends on `/account` existing.
- **Env vars added**:
  - `DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE` (Flavor A, config-derived) —
    Phase 0.
  - `STRIPE_WEBHOOK_SECRET` (Flavor B, external secret) — Phase 1.
  - `STRIPE_PRICE_ID` may already exist for Phase 0; if not, add as
    Flavor B in Phase 3 for the create-subscription call.
- **Stripe Billing Portal is NOT integrated.** Phase 3's error path for
  expired cards links to a `mailto`. If we ever want self-serve card
  update, that's a separate piece of work.
