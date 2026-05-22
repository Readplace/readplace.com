# Phase 0 — `subscription_providers` Table

## Why

Today the `users` table has no subscription linkage. The Stripe checkout
success handler (`projects/hutch/src/runtime/web/auth/auth.page.ts` lines
298-400) creates the user but discards `subscriptionId` and `customerId`
from the checkout session. Without these IDs we cannot:

- Operate on the subscription (cancel, resume, refund).
- Tell apart founding members from paying users.
- Add a second provider (Apple IAP, Paddle) later without rewriting access
  logic.

This phase creates a decoupled association table that maps `userId` to
`{ provider, subscriptionId, customerId, status }`. The `users` table stays
untouched. Provider polymorphism is enforced at the schema layer
(`provider: z.literal("stripe")` for now, extensible to a union later).

## Design

### New DynamoDB table

| Property             | Value                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logical name         | `subscription_providers`                                                                                                                           |
| Hash key             | `userId` (String)                                                                                                                                  |
| Range key            | none (one row per user)                                                                                                                            |
| GSIs                 | `subscriptionId-index` (hashKey `subscriptionId`, projects `ALL`). Required for the Phase 1 webhook handler — given a Stripe `subscription.id`, find the user. |
| Billing              | `PAY_PER_REQUEST`                                                                                                                                  |
| PITR                 | enabled                                                                                                                                            |
| Deletion protection  | matches `args.deletionProtection` (true in prod)                                                                                                   |

### Row schema

```ts
// projects/hutch/src/runtime/providers/subscription-providers/
//   dynamodb-subscription-providers.ts

const SubscriptionProviderRow = z.object({
  userId: UserIdSchema,
  provider: z.literal("stripe"), // future: z.enum(["stripe", "apple", ...])
  subscriptionId: z.string(),
  customerId: z.string(),
  status: z.enum(["active", "pending_cancellation", "cancelled"]),
  cancellationEffectiveAt: dynamoField(z.string()), // ISO; set when status="pending_cancellation"
  createdAt: z.string(),
  updatedAt: z.string(),
});
```

Notes:

- `subscriptionId` may change over the lifetime of a user. When a cancelled
  user resumes (Phase 3), we create a NEW Stripe subscription and overwrite
  the row's `subscriptionId`. The old `subscriptionId` is forgotten in our
  store — Stripe remains the historical record.
- `provider: z.literal("stripe")` — when we add a second provider it
  becomes `z.enum([...])` and downstream code already destructures by
  provider name.
- Branded `UserIdSchema` from `@packages/domain/user` matches existing
  convention (see `dynamodb-auth.ts` line 32).

## Files to add

| File | Purpose |
| --- | --- |
| `projects/hutch/src/runtime/providers/subscription-providers/dynamodb-subscription-providers.ts` | Thin DynamoDB wrapper. Returns `{ findByUserId, findBySubscriptionId, upsertActive, markPendingCancellation, markCancelled, markActive }`. Mirrors the pattern in `dynamodb-auth.ts`. |
| `projects/hutch/src/runtime/providers/subscription-providers/dynamodb-subscription-providers.test.ts` | Unit test with `Partial<DynamoDBDocumentClient>` fake pattern (see test-driven-design skill, "Thin AWS SDK Wrappers"). |
| `projects/hutch/src/runtime/domain/subscription/subscription.types.ts` | Domain types: `SubscriptionStatus`, `SubscriptionRecord`. |
| `src/packages/test-fixtures/providers/subscription-providers/index.ts` | In-memory test double for use in route/page tests. |

## Files to modify

### Infrastructure (per infrastructure-design skill, Flavor A — config-derived)

| File | Change |
| --- | --- |
| `projects/hutch/src/infra/hutch-storage.ts` | Add `subscriptionProvidersTable` field; add `subscriptionProviders: string` to `tableNames`; add new `aws.dynamodb.Table('hutch-subscription-providers', {...})` block following the `usersTable` shape on lines 76-93, plus the `subscriptionId-index` GSI. |
| `projects/hutch/src/infra/index.ts` | Read `config.require("dynamodbSubscriptionProvidersTable")`; pass to `HutchStorage`; grant via `HutchDynamoDBAccess` (Query on the GSI included); add `DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE: requireEnv(...)` to the Lambda env block. |
| `projects/hutch/Pulumi.prod.yaml` | Add `hutch:dynamodbSubscriptionProvidersTable: hutch-subscription-providers-prod`. |
| `projects/hutch/Pulumi.staging.yaml` | Add `hutch:dynamodbSubscriptionProvidersTable: hutch-subscription-providers-staging`. |

### Runtime composition root

| File | Change |
| --- | --- |
| `projects/hutch/src/runtime/server.ts` (composition root) | Call `initDynamoDbSubscriptionProviders({ client, tableName: requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE") })`. Pass the result into the deps of the auth/checkout-success page handler. |

### Stripe checkout flow (the connective tissue)

| File | Change |
| --- | --- |
| `projects/hutch/src/runtime/providers/stripe-checkout/stripe-checkout.ts` | Extend `retrieveCheckoutSession` to return `subscriptionId` (from `session.subscription`) and `customerId` (from `session.customer`). Both come back as strings when the session is in `mode: 'subscription'`. |
| `projects/hutch/src/runtime/web/auth/auth.page.ts` (lines 338-400, `GET /auth/checkout/success`) | After successful `createUserWithPasswordHash` / `createGoogleUser`, call `subscriptionProviders.upsertActive({ userId, provider: 'stripe', subscriptionId, customerId })`. Fail loudly if the write fails — we must never have an orphaned paid user. |

## Migration (manual)

Only one existing paid user. After deploy, the user manually inserts a row
via the AWS DynamoDB console (see Context section of the parent plan for the
exact item).

No script needed. All other users (free email signups) intentionally have
no row — they're implicit founding members.

## Architecture snapshot

This phase adds **NO** `defineCommand` / `defineEvent` declarations. Per the
infrastructure-design skill's snapshot rule, no `.architecture/<hash>/`
snapshot is required.

## Tests

- Unit-test `dynamodb-subscription-providers.ts` with a
  `Partial<DynamoDBDocumentClient>` fake — assert `UpdateExpression`,
  `ConditionExpression`, and value shape using `toContain`.
- Add an integration test for the checkout-success handler that asserts
  the `subscription_providers` row is written with `status: 'active'`.
- Update the existing checkout-success integration test if it asserts the
  full set of side effects.

## Verification

1. `pnpm nx test hutch` — all unit tests green.
2. `pnpm nx check-infra hutch` — Pulumi preview shows the new table and
   GSI.
3. Deploy to staging. Walk through Stripe checkout end-to-end. Verify a
   row appears in the staging `subscription_providers` table with the
   expected `subscriptionId` / `customerId` / `status: 'active'`.
4. After production deploy, the user manually inserts the row for the one
   existing paid account.
