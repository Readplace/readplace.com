import { paidFeatureSirenError } from "./paid-feature-siren";

describe("paidFeatureSirenError", () => {
	it("is an error entity carrying a server-authored warning message", () => {
		const entity = paidFeatureSirenError();
		expect(entity.class).toEqual(["error"]);
		expect(entity.properties?.messages).toEqual([
			{
				type: "warning",
				content: {
					type: "text/html",
					body: "This feature isn't on the free plan.",
				},
			},
		]);
	});

	it("carries no code — the client keys off the message, not a per-feature code", () => {
		const entity = paidFeatureSirenError();
		expect(entity.properties?.code).toBeUndefined();
	});

	it("models no action — upgrading happens on the web, not a transition the client invokes", () => {
		const entity = paidFeatureSirenError();
		expect(entity.actions).toBeUndefined();
	});
});
