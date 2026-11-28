export class UnconfiguredStripeEventError extends Error {
	constructor(type: string) {
		super(`No handler configured for Stripe event type: ${type}`);
		this.name = "UnconfiguredStripeEventError";
	}
}
