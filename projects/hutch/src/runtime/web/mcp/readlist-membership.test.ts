import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import { initResolveReadlistMembership } from "./readlist-membership";

describe("initResolveReadlistMembership", () => {
	it("resolves a page in two reads, preserving readlist order and dropping orphaned copies", async () => {
		const userId = authenticatedUserIdFrom("00000000000000000000000000000001");
		const work = ReadlistSlugSchema.parse("work");
		const weekend = ReadlistSlugSchema.parse("weekend");
		const orphan = ReadlistSlugSchema.parse("deleted");
		const urls = ["https://example.com/a", "https://example.com/b", "https://example.com/c"];
		const listReadlistDefinitions = jest.fn(async () => [
			{ slug: work, label: "Work", createdAt: new Date("2026-01-01") },
			{ slug: weekend, label: "Weekend", createdAt: new Date("2026-01-02") },
		]);
		const listUserSavesForUrls = jest.fn(async () => new Map([
			[urls[0], [{ readlist: weekend }, {}, { readlist: work }, { readlist: orphan }]],
			[urls[1], [{ readlist: work }]],
		]));
		const resolve = initResolveReadlistMembership({ listReadlistDefinitions, listUserSavesForUrls });

		expect(await resolve({ userId, urls })).toEqual(new Map([
			[urls[0], [
				{ id: DEFAULT_READLIST_SLUG, name: "All" },
				{ id: work, name: "Work" },
				{ id: weekend, name: "Weekend" },
			]],
			[urls[1], [{ id: work, name: "Work" }]],
			[urls[2], []],
		]));
		expect(listReadlistDefinitions.mock.calls).toEqual([[userId]]);
		expect(listUserSavesForUrls.mock.calls).toEqual([[{ userId, urls, readlists: [DEFAULT_READLIST_SLUG, work, weekend] }]]);
	});

	it("performs no reads for an empty article page", async () => {
		const listReadlistDefinitions = jest.fn();
		const listUserSavesForUrls = jest.fn();
		const resolve = initResolveReadlistMembership({ listReadlistDefinitions, listUserSavesForUrls });
		expect(await resolve({
			userId: authenticatedUserIdFrom("00000000000000000000000000000001"),
			urls: [],
		})).toEqual(new Map());
		expect(listReadlistDefinitions.mock.calls).toEqual([]);
		expect(listUserSavesForUrls.mock.calls).toEqual([]);
	});
});
