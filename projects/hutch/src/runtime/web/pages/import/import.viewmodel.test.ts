import { ImportSessionIdSchema } from "@packages/domain/import-session";
import type { ImportSession } from "@packages/domain/import-session";
import { UserIdSchema } from "@packages/domain/user";
import { toImportUploadViewModel, toImportViewModel } from "./import.viewmodel";

function makeSession(overrides: Partial<ImportSession> = {}): ImportSession {
	return {
		id: ImportSessionIdSchema.parse("0123456789abcdef0123456789abcdef"),
		userId: UserIdSchema.parse("00000000000000000000000000000001"),
		createdAt: "2026-05-01T00:00:00.000Z",
		expiresAt: 1_780_000_000,
		totalUrls: 0,
		totalFoundInFile: 0,
		truncated: false,
		deselected: new Set<number>(),
		...overrides,
	};
}

describe("toImportViewModel", () => {
	it("renders every URL as checked when nothing is deselected", () => {
		const session = makeSession({ totalUrls: 2 });

		const vm = toImportViewModel(
			{ session, pageUrls: ["https://example.com/a", "https://example.com/b"], page: 1, pageSize: 50 },
			2,
		);

		expect(vm.rows).toEqual([
			{ index: 0, url: "https://example.com/a", checked: true },
			{ index: 1, url: "https://example.com/b", checked: true },
		]);
		expect(vm.totalSelected).toBe(2);
		expect(vm.commitUrl).toBe(`/import/${session.id}/commit`);
		expect(vm.toggleUrl).toBe(`/import/${session.id}/toggle`);
	});

	it("marks deselected indexes as unchecked", () => {
		const session = makeSession({ totalUrls: 3, deselected: new Set([1]) });

		const vm = toImportViewModel(
			{
				session,
				pageUrls: ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
				page: 1,
				pageSize: 50,
			},
			2,
		);

		expect(vm.rows.map((r) => r.checked)).toEqual([true, false, true]);
	});

	it("computes pagination URLs across multi-page sessions", () => {
		const session = makeSession({ totalUrls: 120 });
		const pageSize = 50;

		const page1 = toImportViewModel({ session, pageUrls: [], page: 1, pageSize }, 120);
		const page2 = toImportViewModel({ session, pageUrls: [], page: 2, pageSize }, 120);
		const page3 = toImportViewModel({ session, pageUrls: [], page: 3, pageSize }, 120);

		expect(page1.totalPages).toBe(3);
		expect(page1.prevUrl).toBeUndefined();
		expect(page1.nextUrl).toBe(`/import/${session.id}?page=2`);
		expect(page2.prevUrl).toBe(`/import/${session.id}`);
		expect(page2.nextUrl).toBe(`/import/${session.id}?page=3`);
		expect(page3.prevUrl).toBe(`/import/${session.id}?page=2`);
		expect(page3.nextUrl).toBeUndefined();
	});

	it("offsets row indexes by the page number", () => {
		const session = makeSession({ totalUrls: 60 });

		const vm = toImportViewModel(
			{
				session,
				pageUrls: ["https://example.com/p2-a", "https://example.com/p2-b"],
				page: 2,
				pageSize: 50,
			},
			60,
		);

		expect(vm.rows.map((r) => r.index)).toEqual([50, 51]);
	});

	it("flags the master checkbox as fully selected when nothing is deselected", () => {
		const session = makeSession({ totalUrls: 3 });

		const vm = toImportViewModel(
			{ session, pageUrls: [], page: 1, pageSize: 50 },
			3,
		);

		expect(vm.allSelected).toBe(true);
		expect(vm.noneSelected).toBe(false);
		expect(vm.someSelected).toBe(false);
		expect(vm.toggleAllUrl).toBe(`/import/${session.id}/toggle-all`);
	});

	it("flags the master checkbox as fully deselected when every row is deselected", () => {
		const session = makeSession({ totalUrls: 2, deselected: new Set([0, 1]) });

		const vm = toImportViewModel(
			{ session, pageUrls: [], page: 1, pageSize: 50 },
			0,
		);

		expect(vm.allSelected).toBe(false);
		expect(vm.noneSelected).toBe(true);
		expect(vm.someSelected).toBe(false);
	});

	it("flags the master checkbox as partially selected (indeterminate) when some are deselected", () => {
		const session = makeSession({ totalUrls: 3, deselected: new Set([1]) });

		const vm = toImportViewModel(
			{ session, pageUrls: [], page: 1, pageSize: 50 },
			2,
		);

		expect(vm.allSelected).toBe(false);
		expect(vm.noneSelected).toBe(false);
		expect(vm.someSelected).toBe(true);
	});

	it("propagates the truncated flag and totalFoundInFile from the session header", () => {
		const session = makeSession({ totalUrls: 2_000, totalFoundInFile: 2_345, truncated: true });

		const vm = toImportViewModel(
			{ session, pageUrls: ["https://example.com/x"], page: 1, pageSize: 50 },
			2_000,
		);

		expect(vm.truncated).toBe(true);
		expect(vm.totalFoundInFile).toBe(2_345);
	});
});

describe("toImportUploadViewModel", () => {
	it("returns the upload action URL pre-baked with the feature flag so the form preserves the toggle", () => {
		const vm = toImportUploadViewModel({});
		expect(vm.uploadAction).toBe("/import?feature=import");
	});

	it("passes through an error message when provided", () => {
		const vm = toImportUploadViewModel({ errors: [{ message: "We couldn't find any links in that file." }] });
		expect(vm.errors?.[0]?.message).toBe("We couldn't find any links in that file.");
	});

	it("leaves errors undefined when no message is provided", () => {
		const vm = toImportUploadViewModel({});
		expect(vm.errors).toBeUndefined();
	});
});
