import { subscriptionInactiveSirenError } from "./subscription-inactive-siren";

describe("subscriptionInactiveSirenError", () => {
	it("is an error entity carrying a server-authored warning message", () => {
		const entity = subscriptionInactiveSirenError();
		expect(entity.class).toEqual(["error"]);
		expect(entity.properties?.messages).toEqual([
			{
				type: "warning",
				content: {
					type: "text/html",
					body: expect.stringContaining("subscription"),
				},
			},
		]);
	});

	it("carries no code — the client keys off the message, not a per-feature code", () => {
		const entity = subscriptionInactiveSirenError();
		expect(entity.properties?.code).toBeUndefined();
	});

	it("models no action — reactivating happens on the web, not a transition the client invokes", () => {
		const entity = subscriptionInactiveSirenError();
		expect(entity.actions).toBeUndefined();
	});
});
