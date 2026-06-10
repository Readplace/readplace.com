import assert from "node:assert/strict";
import {
	ACCOUNT_LOCKED_CODE,
	UNLOCK_ACTION_NAME,
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

	it("carries a single unlock action a client can render as a button", () => {
		const entity = accountLockedSirenError();
		assert(entity.actions, "locked error must carry actions");
		expect(entity.actions).toHaveLength(1);
		const [action] = entity.actions;
		expect(action.name).toBe(UNLOCK_ACTION_NAME);
		expect(action.href).toBe("mailto:readplace+verification@readplace.com");
		expect(action.method).toBe("GET");
		assert(action.title, "unlock action must carry a button label");
		expect(action.title.length).toBeGreaterThan(0);
	});
});
