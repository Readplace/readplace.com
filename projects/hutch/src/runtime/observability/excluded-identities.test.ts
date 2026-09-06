import {
	assertExcludedUserIds,
	assertExcludedVisitorIds,
	excludeNonAudienceClauses,
} from "./excluded-identities";

const VALID_VISITOR_ID = "293b32c4-898e-485d-8a92-3f2f32f53289";
const VALID_USER_ID = "f19792f1a14cf1d500de060278ab4bc3";

const BOTH = {
	excludedVisitorIds: [VALID_VISITOR_ID],
	excludedUserIds: [VALID_USER_ID],
};

const NONE = {
	excludedVisitorIds: [],
	excludedUserIds: [],
};

describe("assertExcludedVisitorIds", () => {
	it("accepts an empty list and lowercase UUID entries", () => {
		expect(() => assertExcludedVisitorIds([])).not.toThrow();
		expect(() => assertExcludedVisitorIds([VALID_VISITOR_ID])).not.toThrow();
	});

	it.each([
		{ name: "uppercase", value: VALID_VISITOR_ID.toUpperCase() },
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
		{ name: "a truncated user id", value: VALID_USER_ID.slice(0, -1) },
		{ name: "a user id with a trailing character", value: `${VALID_USER_ID}0` },
		{ name: "non-hex characters", value: `${VALID_USER_ID.slice(0, -1)}z` },
		{ name: "an empty string", value: "" },
	])("rejects $name", ({ value }) => {
		expect(() => assertExcludedUserIds([value])).toThrow("excludedUserIds");
	});
});

const BOT_CLAUSE = '| filter (not ispresent(device_class)) or (device_class != "bot")';

describe("excludeNonAudienceClauses", () => {
	it("emits the bot clause alone when no identity list is configured, so no widget can ever count a crawler", () => {
		expect(excludeNonAudienceClauses(NONE)).toEqual([BOT_CLAUSE]);
	});

	it("emits one clause per configured key, each keyed on its own field, with the bot clause last", () => {
		expect(excludeNonAudienceClauses(BOTH)).toEqual([
			`| filter (not ispresent(visitor_id)) or (visitor_id not in ["${VALID_VISITOR_ID}"])`,
			`| filter (not ispresent(user_id)) or (user_id not in ["${VALID_USER_ID}"])`,
			BOT_CLAUSE,
		]);
	});

	it.each([
		{
			name: "visitor ids",
			identities: { ...NONE, excludedVisitorIds: [VALID_VISITOR_ID] },
			expected: [
				`| filter (not ispresent(visitor_id)) or (visitor_id not in ["${VALID_VISITOR_ID}"])`,
				BOT_CLAUSE,
			],
		},
		{
			name: "user ids",
			identities: { ...NONE, excludedUserIds: [VALID_USER_ID] },
			expected: [
				`| filter (not ispresent(user_id)) or (user_id not in ["${VALID_USER_ID}"])`,
				BOT_CLAUSE,
			],
		},
	])("emits only the $name clause beside the bot clause when only that list is configured", ({ identities, expected }) => {
		expect(excludeNonAudienceClauses(identities)).toEqual(expected);
	});

	it("guards the absent-field half on every clause, so an event that carries none of the keys survives", () => {
		const clauses = excludeNonAudienceClauses(BOTH);

		expect(clauses).toHaveLength(3);
		for (const clause of clauses) {
			expect(clause).toMatch(/^\| filter \(not ispresent\((\w+)\)\) or \(\1 (?:not in \[|!= ")/);
		}
	});

	it("quotes every entry so a list of several renders as one in-list", () => {
		const other = "d1ed4498-77f2-4d8b-b139-920d06b064b6";
		const [clause] = excludeNonAudienceClauses({
			...NONE,
			excludedVisitorIds: [VALID_VISITOR_ID, other],
		});

		expect(clause).toBe(
			`| filter (not ispresent(visitor_id)) or (visitor_id not in ["${VALID_VISITOR_ID}", "${other}"])`,
		);
	});
});
