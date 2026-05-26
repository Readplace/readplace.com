/** Shared contract between the runtime dispatcher and the infra component
 * that declares which Stripe events the deployed webhook receiver handles.
 *
 * Adding an event type here forces two parallel updates:
 *   1. Runtime composition root — the `Record<StripeEventType, …>` is
 *      non-Partial, so TypeScript fails until a handler is wired.
 *   2. Infra `events: [...]` — only values from this union are accepted,
 *      and the operator must add the event in the Stripe Dashboard too.
 *
 * Drift in either direction surfaces as a CloudWatch alarm: the runtime
 * dispatcher throws `UnconfiguredStripeEventError` on unknown event types,
 * which propagates as a Lambda error → 5xx → Stripe retry. */
export type StripeEventType =
	| "customer.subscription.deleted";
