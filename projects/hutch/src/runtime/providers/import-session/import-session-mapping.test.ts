import { UserIdSchema } from "@packages/domain/user";
import { ImportSessionIdSchema } from "@packages/domain/import-session";
import {
	computeDeselected,
	type ImportSessionRow,
	toImportSession,
} from "./import-session-mapping";

const SESSION_ID = ImportSessionIdSchema.parse("a".repeat(32));
const USER = UserIdSchema.parse("user-1");

function row(overrides: Partial<ImportSessionRow> = {}): ImportSessionRow {
	return {
		sessionId: SESSION_ID,
		userId: USER,
		createdAt: "2026-06-20T00:00:00.000Z",
		expiresAt: 1_700_000_000,
		totalUrls: 3,
		totalFoundInFile: 5,
		truncated: true,
		urls: ["https://a.example", "https://b.example", "https://c.example"],
		...overrides,
	};
}

describe("computeDeselected", () => {
	it("returns the stored deselected indices when allSelected is true", () => {
		const result = computeDeselected({ allSelected: true, deselected: [1], totalUrls: 3 });
		expect([...result]).toEqual([1]);
	});

	it("treats a missing allSelected flag as everything selected", () => {
		const result = computeDeselected({ deselected: [2], totalUrls: 3 });
		expect([...result]).toEqual([2]);
	});

	it("defaults a missing deselected list to an empty set when allSelected is true", () => {
		const result = computeDeselected({ allSelected: true, totalUrls: 3 });
		expect([...result]).toEqual([]);
	});

	it("deselects every index when allSelected is false", () => {
		const result = computeDeselected({ allSelected: false, deselected: [], totalUrls: 3 });
		expect([...result].sort((a, b) => a - b)).toEqual([0, 1, 2]);
	});
});

describe("toImportSession", () => {
	it("maps a stored row to the domain session with computed deselection", () => {
		const session = toImportSession(row({ allSelected: true, deselected: [0, 2] }));
		expect(session).toEqual({
			id: SESSION_ID,
			userId: USER,
			createdAt: "2026-06-20T00:00:00.000Z",
			expiresAt: 1_700_000_000,
			totalUrls: 3,
			totalFound: 5,
			truncated: true,
			deselected: new Set([0, 2]),
		});
	});

	it("marks every index deselected when the stored row has allSelected false", () => {
		const session = toImportSession(row({ allSelected: false, deselected: [] }));
		expect(session.deselected).toEqual(new Set([0, 1, 2]));
	});
});
