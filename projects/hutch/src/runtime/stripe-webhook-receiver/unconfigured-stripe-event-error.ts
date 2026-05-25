export class UnconfiguredStripeEventError extends Error {
	readonly type: string;

	constructor(type: string) {
		super(`No handler configured for Stripe event type: ${type}`);
		this.type = type;
		this.name = "UnconfiguredStripeEventError";
	}
}
