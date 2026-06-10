import {
	ACCOUNT_LOCKED_CODE,
	accountLockedSirenError,
} from "./account-locked-siren";

describe("accountLockedSirenError", () => {
	it("is an error entity carrying the lock code and the contact message", () => {
		const entity = accountLockedSirenError();
		expect(entity.class).toEqual(["error"]);
		expect(entity.properties?.code).toBe(ACCOUNT_LOCKED_CODE);
		expect(entity.properties?.message).toContain(
			"readplace+verification@readplace.com",
		);
	});

	it("models no action — restoring access is something the user reads, not a transition the client invokes", () => {
		const entity = accountLockedSirenError();
		expect(entity.actions).toBeUndefined();
	});
});
