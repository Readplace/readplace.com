import { PENDING_SAVE_COOKIE_NAME, readPendingSaveId } from "./pending-save";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("readPendingSaveId", () => {
	it("returns the id from a valid cookie", () => {
		expect(readPendingSaveId({ cookies: { [PENDING_SAVE_COOKIE_NAME]: VALID_UUID } })).toBe(VALID_UUID);
	});

	it("returns undefined when there is no cookie jar", () => {
		expect(readPendingSaveId({})).toBeUndefined();
	});

	it("returns undefined when the cookie is absent", () => {
		expect(readPendingSaveId({ cookies: {} })).toBeUndefined();
	});

	it("treats a non-string cookie as absent", () => {
		expect(readPendingSaveId({ cookies: { [PENDING_SAVE_COOKIE_NAME]: 42 } })).toBeUndefined();
	});

	it("treats a tampered (non-uuid) cookie as absent so it never reaches the conversion event", () => {
		expect(readPendingSaveId({ cookies: { [PENDING_SAVE_COOKIE_NAME]: "not-a-uuid" } })).toBeUndefined();
	});
});
