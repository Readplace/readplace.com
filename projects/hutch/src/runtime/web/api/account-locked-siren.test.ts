import { accountLockedSirenError } from "./account-locked-siren";

describe("accountLockedSirenError", () => {
	it("is an error entity carrying a server-authored warning message", () => {
		const entity = accountLockedSirenError();
		expect(entity.class).toEqual(["error"]);
		expect(entity.properties?.messages).toEqual([
			{
				type: "warning",
				content: {
					type: "text/html",
					body: expect.stringContaining("readplace+verification@readplace.com"),
				},
			},
		]);
	});

	it("carries no code — the client keys off the message, not a per-feature code", () => {
		const entity = accountLockedSirenError();
		expect(entity.properties?.code).toBeUndefined();
	});

	it("models no action — restoring access is something the user reads, not a transition the client invokes", () => {
		const entity = accountLockedSirenError();
		expect(entity.actions).toBeUndefined();
	});
});
