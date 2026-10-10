import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import {
	buildReadlistCountsUrl,
	buildReadlistUrl,
	canonicalReadlistPageRedirect,
	parseReadlistUrl,
	toArticleDiscoveryQuery,
} from "./readlist.url";

describe("parseReadlistUrl", () => {
	it("should default to readlist tab for empty query", () => {
		const state = parseReadlistUrl({});
		expect(state).toEqual({ readlist: DEFAULT_READLIST_SLUG, tab: "queue", order: undefined, page: 1 });
	});

	it("should parse tab parameter", () => {
		expect(parseReadlistUrl({ tab: "done" }).tab).toBe("done");
		expect(parseReadlistUrl({ tab: "queue" }).tab).toBe("queue");
	});

	it("should default to readlist tab for invalid tab", () => {
		expect(parseReadlistUrl({ tab: "invalid" }).tab).toBe("queue");
	});

	it("should map legacy status=read to done tab", () => {
		expect(parseReadlistUrl({ status: "read" }).tab).toBe("done");
	});

	it("should map legacy status=unread to readlist tab", () => {
		expect(parseReadlistUrl({ status: "unread" }).tab).toBe("queue");
	});

	it("should prefer tab over legacy status when both present", () => {
		expect(parseReadlistUrl({ tab: "queue", status: "read" }).tab).toBe("queue");
	});

	it("should default to readlist tab for invalid legacy status", () => {
		expect(parseReadlistUrl({ status: "invalid" }).tab).toBe("queue");
	});

	it("should parse order", () => {
		expect(parseReadlistUrl({ order: "asc" }).order).toBe("asc");
		expect(parseReadlistUrl({ order: "desc" }).order).toBe("desc");
	});

	it("should return undefined for invalid order", () => {
		expect(parseReadlistUrl({ order: "invalid" }).order).toBeUndefined();
	});

	it("should parse page number", () => {
		expect(parseReadlistUrl({ page: "3" }).page).toBe(3);
	});

	it("should default to page 1 for invalid page", () => {
		expect(parseReadlistUrl({ page: "-1" }).page).toBe(1);
		expect(parseReadlistUrl({ page: "abc" }).page).toBe(1);
		expect(parseReadlistUrl({ page: "0" }).page).toBe(1);
	});

	it("should parse the readlist being viewed", () => {
		expect(parseReadlistUrl({ queue: DEFAULT_READLIST_SLUG }).readlist).toBe("default");
	});

	it("should keep a well-formed readlist name so the route can resolve it against the reader's readlists", () => {
		expect(parseReadlistUrl({ queue: "someone-elses" }).readlist).toBe("someone-elses");
	});

	it("should fall back to the default readlist for a name no readlist could ever carry", () => {
		for (const readlist of ["Bad Name", "UPPER", "", "-lead", "a".repeat(25)]) {
			expect(parseReadlistUrl({ readlist }).readlist).toBe("default");
		}
	});

	it("should read the readlist and the read-state tab as independent choices", () => {
		expect(parseReadlistUrl({ queue: DEFAULT_READLIST_SLUG, tab: "done" })).toEqual({
			readlist: DEFAULT_READLIST_SLUG,
			tab: "done",
			order: undefined,
			page: 1,
		});
	});

});

describe("buildReadlistUrl", () => {
	it("should return /queue for defaults", () => {
		expect(buildReadlistUrl({})).toBe("/queue");
	});

	it("should omit default tab (readlist)", () => {
		expect(buildReadlistUrl({ tab: "queue" })).toBe("/queue");
	});

	it("should include non-default tab", () => {
		expect(buildReadlistUrl({ tab: "done" })).toBe("/queue?tab=done");
	});

	it("should omit order matching tab defaultOrder", () => {
		expect(buildReadlistUrl({ order: "desc" })).toBe("/queue");
		expect(buildReadlistUrl({ tab: "done", order: "desc" })).toBe("/queue?tab=done");
	});

	it("should include order differing from tab defaultOrder", () => {
		expect(buildReadlistUrl({ order: "asc" })).toBe("/queue?order=asc");
		expect(buildReadlistUrl({ tab: "done", order: "asc" })).toBe("/queue?tab=done&order=asc");
	});

	it("should omit page 1", () => {
		expect(buildReadlistUrl({ page: 1 })).toBe("/queue");
	});

	it("should include page > 1", () => {
		expect(buildReadlistUrl({ page: 2 })).toBe("/queue?page=2");
	});

	it("should combine multiple params", () => {
		const url = buildReadlistUrl({ tab: "done", order: "asc", page: 3 });
		expect(url).toContain("tab=done");
		expect(url).toContain("order=asc");
		expect(url).toContain("page=3");
	});

	it("should leave the readlist out of the URL while the default readlist is the one being viewed", () => {
		expect(buildReadlistUrl(parseReadlistUrl({ queue: DEFAULT_READLIST_SLUG, tab: "done" }))).toBe("/queue?tab=done");
	});

	it("should drop unmodelled params on the round trip, so a transient pair rides only the link that passes it through extraParams", () => {
		expect(buildReadlistUrl(parseReadlistUrl({ tab: "done", ref: "my", utm_source: "x" }))).toBe(
			"/queue?tab=done",
		);
	});

});

describe("buildReadlistCountsUrl", () => {
	it("should return the bare counts path for defaults", () => {
		expect(buildReadlistCountsUrl({})).toBe("/queue/counts");
	});

	it("should carry the filters the counted page was rendered with", () => {
		expect(buildReadlistCountsUrl({ tab: "done", order: "asc", page: 3 })).toBe(
			"/queue/counts?tab=done&order=asc&page=3",
		);
	});

	it("should omit params the readlist URL omits so both describe the same view", () => {
		expect(buildReadlistCountsUrl({ tab: "queue", order: "desc", page: 1 })).toBe("/queue/counts");
	});
});

describe("canonicalReadlistPageRedirect", () => {
	it("returns undefined for an in-bounds page", () => {
		expect(
			canonicalReadlistPageRedirect({ state: { readlist: DEFAULT_READLIST_SLUG, tab: "queue", page: 1 }, total: 20, pageSize: 20 }),
		).toBeUndefined();
	});

	it("clamps page 2 of a single-page result back to page 1 (/queue)", () => {
		expect(
			canonicalReadlistPageRedirect({ state: { readlist: DEFAULT_READLIST_SLUG, tab: "queue", page: 2 }, total: 20, pageSize: 20 }),
		).toBe("/queue");
	});

	it("returns undefined for the last valid page", () => {
		expect(
			canonicalReadlistPageRedirect({ state: { readlist: DEFAULT_READLIST_SLUG, tab: "queue", page: 3 }, total: 60, pageSize: 20 }),
		).toBeUndefined();
	});

	it("clamps a page beyond the last to the last valid page", () => {
		expect(
			canonicalReadlistPageRedirect({ state: { readlist: DEFAULT_READLIST_SLUG, tab: "queue", page: 4 }, total: 60, pageSize: 20 }),
		).toBe("/queue?page=3");
	});

	it("preserves extra params (utm + status flash) on the clamped URL", () => {
		expect(
			canonicalReadlistPageRedirect({
				state: { readlist: DEFAULT_READLIST_SLUG, tab: "queue", page: 2 },
				total: 20,
				pageSize: 20,
				extraParams: [
					["utm_source", "queue"],
					["status_changed", "read"],
					["status_article", "abc"],
				],
			}),
		).toBe("/queue?utm_source=queue&status_changed=read&status_article=abc");
	});

	it("clamps page 2 of an empty readlist to page 1 so the empty state renders", () => {
		expect(
			canonicalReadlistPageRedirect({ state: { readlist: DEFAULT_READLIST_SLUG, tab: "queue", page: 2 }, total: 0, pageSize: 20 }),
		).toBe("/queue");
	});
});

describe("search and filters in the readlist URL", () => {
	it("round-trips a full search and filter state in canonical order, between the order and the page", () => {
		const state = parseReadlistUrl({
			queue: "work",
			tab: "done",
			order: "asc",
			q: "  personal   finance ",
			time: ["10-20", "5-10"],
			saved: "month",
			topic: ["others", "Personal finance", "Focus"],
			page: "2",
		});

		expect(buildReadlistUrl(state)).toBe(
			"/queue?queue=work&tab=done&order=asc&q=personal+finance&time=5-10&time=10-20&saved=month&topic=Focus&topic=Personal+finance&topic=others&page=2",
		);
	});

	it("drops repeated values and sorts the rest into the order the drawer lists them", () => {
		const state = parseReadlistUrl({ time: ["10-20", "5-10", "5-10"], saved: ["older", "today", "today"] });

		expect(buildReadlistUrl(state)).toBe("/queue?time=5-10&time=10-20&saved=today&saved=older");
	});

	it("drops values no option offers", () => {
		expect(parseReadlistUrl({ time: ["5-10", "forever"], saved: "yesterday" }).discovery).toEqual({
			q: undefined,
			time: ["5-10"],
			saved: [],
			topic: [],
		});
	});

	it("leaves a search of only whitespace out of the state", () => {
		expect(parseReadlistUrl({ q: "   " }).discovery).toBeUndefined();
	});

	it("cuts a long search to 200 characters", () => {
		expect(parseReadlistUrl({ q: "a".repeat(250) }).discovery?.q).toBe("a".repeat(200));
	});

	it("keeps every ticked topic, however many, merging two spellings of one topic", () => {
		const state = parseReadlistUrl({ topic: ["Trends", "Focus", "Fintech", "Lifestyle", "focus"] });

		expect(state.discovery?.topic).toEqual(["Fintech", "Focus", "Lifestyle", "Trends"]);
	});

	it("reads only the exact value others as the Others option, and drops a topic that reuses its label", () => {
		expect(parseReadlistUrl({ topic: ["Others"] }).discovery).toBeUndefined();
		expect(parseReadlistUrl({ topic: ["others", "Focus"] }).discovery?.topic).toEqual(["Focus", "others"]);
	});

	it("keeps the search and filters on the clamped page of an over-deep filtered list", () => {
		const state = parseReadlistUrl({ q: "finance", saved: "week", page: "5" });

		expect(canonicalReadlistPageRedirect({ state, total: 21, pageSize: 20 })).toBe(
			"/queue?q=finance&saved=week&page=2",
		);
	});

	it("keeps the search and filters on the counts URL of a filtered page", () => {
		const state = parseReadlistUrl({ queue: ReadlistSlugSchema.parse("work"), q: "finance" });

		expect(buildReadlistCountsUrl(state)).toBe("/queue/counts?queue=work&q=finance");
	});

	it("resolves the saved windows against the clock it is given", () => {
		const now = new Date("2026-10-10T12:00:00.000Z");

		expect(toArticleDiscoveryQuery({ time: [], saved: ["today"], topic: [] }, now).savedAtRanges).toEqual([
			{ from: new Date("2026-10-09T12:00:00.000Z") },
		]);
	});
});
