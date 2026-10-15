import { READLIST_SORT_OPTIONS, sortLabel } from "./readlist-sort";

describe("sortLabel", () => {
	it("names the descending order newest first", () => {
		expect(sortLabel("desc")).toBe("Newest first");
	});

	it("names the ascending order oldest first", () => {
		expect(sortLabel("asc")).toBe("Oldest first");
	});
});

describe("READLIST_SORT_OPTIONS", () => {
	it("lists newest first before oldest first", () => {
		expect(READLIST_SORT_OPTIONS).toEqual([
			{ label: "Newest first", order: "desc" },
			{ label: "Oldest first", order: "asc" },
		]);
	});
});
