import {
	assertExcludedUserIds,
	assertExcludedVisitorHashes,
	assertExcludedVisitorIds,
	excludeInternalVisitorsClauses,
} from "./excluded-identities";

const VALID_HASH = "b4248a499303636a";
const VALID_VISITOR_ID = "293b32c4-898e-485d-8a92-3f2f32f53289";
const VALID_USER_ID = "f19792f1a14cf1d500de060278ab4bc3";

const ALL_THREE = {
	excludedVisitorHashes: [VALID_HASH],
	excludedVisitorIds: [VALID_VISITOR_ID],
	excludedUserIds: [VALID_USER_ID],
};

const NONE = {
	excludedVisitorHashes: [],
	excludedVisitorIds: [],
	excludedUserIds: [],
};

describe("assertExcludedVisitorHashes", () => {
	it("accepts an empty list and lowercase hex entries", () => {
		expect(() => assertExcludedVisitorHashes([])).not.toThrow();
		expect(() => assertExcludedVisitorHashes([VALID_HASH])).not.toThrow();
	});

	it.each([
		{ name: "uppercase", value: VALID_HASH.toUpperCase() },
		{ name: "non-hex characters", value: "not-a-hash" },
		{ name: "a dashed UUID", value: VALID_VISITOR_ID },
		{ name: "an empty string", value: "" },
	])("rejects $name", ({ value }) => {
		expect(() => assertExcludedVisitorHashes([value])).toThrow("excludedVisitorHashes");
	});
});

describe("assertExcludedVisitorIds", () => {
	it("accepts an empty list and lowercase UUID entries", () => {
		expect(() => assertExcludedVisitorIds([])).not.toThrow();
		expect(() => assertExcludedVisitorIds([VALID_VISITOR_ID])).not.toThrow();
	});

	it.each([
		{ name: "uppercase", value: VALID_VISITOR_ID.toUpperCase() },
		{ name: "a dashless visitor hash", value: VALID_HASH },
		{ name: "a bare 32-hex user id", value: VALID_USER_ID },
		{ name: "a truncated UUID", value: VALID_VISITOR_ID.slice(0, -1) },
		{ name: "a UUID with a trailing character", value: `${VALID_VISITOR_ID}0` },
		{ name: "an empty string", value: "" },
	])("rejects $name", ({ value }) => {
		expect(() => assertExcludedVisitorIds([value])).toThrow("excludedVisitorIds");
	});
});

describe("assertExcludedUserIds", () => {
	it("accepts an empty list and 32-character lowercase hex entries", () => {
		expect(() => assertExcludedUserIds([])).not.toThrow();
		expect(() => assertExcludedUserIds([VALID_USER_ID])).not.toThrow();
	});

	it.each([
		{ name: "uppercase", value: VALID_USER_ID.toUpperCase() },
		{ name: "a dashed UUID", value: VALID_VISITOR_ID },
		{ name: "a 16-character visitor hash", value: VALID_HASH },
		{ name: "a truncated user id", value: VALID_USER_ID.slice(0, -1) },
		{ name: "a user id with a trailing character", value: `${VALID_USER_ID}0` },
		{ name: "non-hex characters", value: `${VALID_USER_ID.slice(0, -1)}z` },
		{ name: "an empty string", value: "" },
	])("rejects $name", ({ value }) => {
		expect(() => assertExcludedUserIds([value])).toThrow("excludedUserIds");
	});
});

describe("excludeInternalVisitorsClauses", () => {
	it("emits nothing when no list is configured", () => {
		expect(excludeInternalVisitorsClauses(NONE)).toEqual([]);
	});

	it("emits one clause per configured key, each keyed on its own field", () => {
		expect(excludeInternalVisitorsClauses(ALL_THREE)).toEqual([
			`| filter (not ispresent(visitor_hash)) or (visitor_hash not in ["${VALID_HASH}"])`,
			`| filter (not ispresent(visitor_id)) or (visitor_id not in ["${VALID_VISITOR_ID}"])`,
			`| filter (not ispresent(user_id)) or (user_id not in ["${VALID_USER_ID}"])`,
		]);
	});

	it.each([
		{
			name: "hashes",
			identities: { ...NONE, excludedVisitorHashes: [VALID_HASH] },
			present: "visitor_hash not in",
			absent: ["visitor_id not in", "user_id not in"],
		},
		{
			name: "visitor ids",
			identities: { ...NONE, excludedVisitorIds: [VALID_VISITOR_ID] },
			present: "visitor_id not in",
			absent: ["visitor_hash not in", "user_id not in"],
		},
		{
			name: "user ids",
			identities: { ...NONE, excludedUserIds: [VALID_USER_ID] },
			present: "user_id not in",
			absent: ["visitor_hash not in", "visitor_id not in"],
		},
	])("emits only the $name clause when only that list is configured", ({ identities, present, absent }) => {
		const clauses = excludeInternalVisitorsClauses(identities);

		expect(clauses).toHaveLength(1);
		expect(clauses[0]).toContain(present);
		for (const other of absent) expect(clauses[0]).not.toContain(other);
	});

	it("guards the absent-field half on every clause, so an event that carries none of the three keys survives", () => {
		const clauses = excludeInternalVisitorsClauses(ALL_THREE);

		expect(clauses).toHaveLength(3);
		for (const clause of clauses) {
			const field = /\((\w+) not in \[/.exec(clause)?.[1];
			expect(field).toBeDefined();
			expect(clause.startsWith(`| filter (not ispresent(${field})) or (`)).toBe(true);
		}
	});

	it("quotes every entry so a list of several renders as one in-list", () => {
		const other = "d1ed4498-77f2-4d8b-b139-920d06b064b6";
		const [clause] = excludeInternalVisitorsClauses({
			...NONE,
			excludedVisitorIds: [VALID_VISITOR_ID, other],
		});

		expect(clause).toBe(
			`| filter (not ispresent(visitor_id)) or (visitor_id not in ["${VALID_VISITOR_ID}", "${other}"])`,
		);
	});
});
