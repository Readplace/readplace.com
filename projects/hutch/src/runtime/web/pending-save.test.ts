import { PENDING_SAVE_COOKIE_NAME, consumePendingSaveId, readPendingSaveId } from "./pending-save";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

function recordingRes(): {
	res: { clearCookie: (name: string, options: { path: string }) => void };
	cleared: { name: string; options: { path: string } }[];
} {
	const cleared: { name: string; options: { path: string } }[] = [];
	return {
		res: { clearCookie: (name, options) => { cleared.push({ name, options }); } },
		cleared,
	};
}

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

describe("consumePendingSaveId", () => {
	it("returns the id and clears the cookie so a held save is consumed exactly once", () => {
		const { res, cleared } = recordingRes();

		const id = consumePendingSaveId({ req: { cookies: { [PENDING_SAVE_COOKIE_NAME]: VALID_UUID } }, res });

		expect(id).toBe(VALID_UUID);
		expect(cleared).toEqual([{ name: PENDING_SAVE_COOKIE_NAME, options: { path: "/" } }]);
	});

	it("clears the cookie even when no valid id is present so a tampered value cannot linger", () => {
		const { res, cleared } = recordingRes();

		const id = consumePendingSaveId({ req: { cookies: { [PENDING_SAVE_COOKIE_NAME]: "not-a-uuid" } }, res });

		expect(id).toBeUndefined();
		expect(cleared).toEqual([{ name: PENDING_SAVE_COOKIE_NAME, options: { path: "/" } }]);
	});
});
