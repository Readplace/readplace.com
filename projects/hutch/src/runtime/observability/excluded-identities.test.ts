import {
	assertExcludedVisitorHashes,
	assertExcludedVisitorIds,
	excludeInternalVisitorsClauses,
} from "./excluded-identities";

const VALID_HASH = "b4248a499303636a";
const VALID_VISITOR_ID = "293b32c4-898e-485d-8a92-3f2f32f53289";

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
		{ name: "a truncated UUID", value: VALID_VISITOR_ID.slice(0, -1) },
		{ name: "a UUID with a trailing character", value: `${VALID_VISITOR_ID}0` },
		{ name: "an empty string", value: "" },
	])("rejects $name", ({ value }) => {
		expect(() => assertExcludedVisitorIds([value])).toThrow("excludedVisitorIds");
	});
});

describe("excludeInternalVisitorsClauses", () => {
	it("emits nothing when neither list is configured", () => {
		expect(
			excludeInternalVisitorsClauses({ excludedVisitorHashes: [], excludedVisitorIds: [] }),
		).toEqual([]);
	});

	it("emits one clause per configured key, each keyed on its own field", () => {
		expect(
			excludeInternalVisitorsClauses({
				excludedVisitorHashes: [VALID_HASH],
				excludedVisitorIds: [VALID_VISITOR_ID],
			}),
		).toEqual([
			`| filter (not ispresent(visitor_hash)) or (visitor_hash not in ["${VALID_HASH}"])`,
			`| filter (not ispresent(visitor_id)) or (visitor_id not in ["${VALID_VISITOR_ID}"])`,
		]);
	});

	it.each([
		{
			name: "hashes",
			identities: { excludedVisitorHashes: [VALID_HASH], excludedVisitorIds: [] },
			present: "visitor_hash not in",
			absent: "visitor_id not in",
		},
		{
			name: "visitor ids",
			identities: { excludedVisitorHashes: [], excludedVisitorIds: [VALID_VISITOR_ID] },
			present: "visitor_id not in",
			absent: "visitor_hash not in",
		},
	])("emits only the $name clause when only that list is configured", ({ identities, present, absent }) => {
		const clauses = excludeInternalVisitorsClauses(identities);

		expect(clauses).toHaveLength(1);
		expect(clauses[0]).toContain(present);
		expect(clauses[0]).not.toContain(absent);
	});

	it("guards the absent-field half on every clause, so an event that carries neither key survives", () => {
		const clauses = excludeInternalVisitorsClauses({
			excludedVisitorHashes: [VALID_HASH],
			excludedVisitorIds: [VALID_VISITOR_ID],
		});

		expect(clauses.length).toBeGreaterThan(0);
		for (const clause of clauses) {
			const field = /\((\w+) not in \[/.exec(clause)?.[1];
			expect(field).toBeDefined();
			expect(clause.startsWith(`| filter (not ispresent(${field})) or (`)).toBe(true);
		}
	});

	it("quotes every entry so a list of several renders as one in-list", () => {
		const other = "d1ed4498-77f2-4d8b-b139-920d06b064b6";
		const [clause] = excludeInternalVisitorsClauses({
			excludedVisitorHashes: [],
			excludedVisitorIds: [VALID_VISITOR_ID, other],
		});

		expect(clause).toBe(
			`| filter (not ispresent(visitor_id)) or (visitor_id not in ["${VALID_VISITOR_ID}", "${other}"])`,
		);
	});
});
