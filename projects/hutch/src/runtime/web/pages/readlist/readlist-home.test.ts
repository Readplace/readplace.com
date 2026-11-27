import { DEFAULT_READLIST_SLUG, HAND_PICKED_SCOPE, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { ReadlistDefinitionData } from "@packages/provider-contracts/article-store";
import { homeEntryReadlistOf, homeReadlistOf, homeReadlistTarget, homeReadlistTargets, setHomeReadlistPath } from "./readlist-home";

const weekend = ReadlistSlugSchema.parse("weekend");
const createdAt = new Date("2026-11-01T01:00:00Z");
const definitions: readonly ReadlistDefinitionData[] = [{ slug: weekend, label: "Weekend", createdAt }];

describe("homeReadlistOf", () => {
	it("falls back to Hand Picked when nothing is stored", () => {
		expect(homeReadlistOf(undefined, definitions)).toBe(HAND_PICKED_SCOPE);
	});

	it.each([DEFAULT_READLIST_SLUG, HAND_PICKED_SCOPE])("keeps the built-in %s", (slug) => {
		expect(homeReadlistOf({ slug }, definitions)).toBe(slug);
	});

	it("keeps a custom readlist only while its creation time matches", () => {
		expect(homeReadlistOf({ slug: weekend, createdAt: createdAt.toISOString() }, definitions)).toBe(weekend);
		expect(homeReadlistOf({ slug: weekend, createdAt: "2026-11-02T01:00:00.000Z" }, definitions)).toBe(HAND_PICKED_SCOPE);
	});
});

describe("homeEntryReadlistOf", () => {
	it("opens \"All\" for a reader who never chose", () => {
		expect(homeEntryReadlistOf(undefined, definitions)).toBe(DEFAULT_READLIST_SLUG);
	});

	it("opens Hand Picked for a reader who chose it", () => {
		expect(homeEntryReadlistOf({ slug: HAND_PICKED_SCOPE }, definitions)).toBe(HAND_PICKED_SCOPE);
	});

	it("opens \"All\" once a chosen custom readlist is gone", () => {
		expect(homeEntryReadlistOf({ slug: weekend, createdAt: createdAt.toISOString() }, [])).toBe(DEFAULT_READLIST_SLUG);
	});
});

describe("homeReadlistTarget", () => {
	it.each([DEFAULT_READLIST_SLUG, HAND_PICKED_SCOPE])("targets the built-in %s without a creation time", (slug) => {
		expect(homeReadlistTarget(slug, definitions)).toEqual({ slug });
	});

	it("targets a custom readlist with its creation time", () => {
		expect(homeReadlistTarget(weekend, definitions)).toEqual({ slug: weekend, createdAt: createdAt.toISOString() });
	});

	it("keeps a custom readlist named hand-picked distinct from the built-in", () => {
		const custom = ReadlistSlugSchema.parse("hand-picked");
		expect(homeReadlistTarget(custom, [{ slug: custom, label: "hand picked", createdAt }])).toEqual({ slug: custom, createdAt: createdAt.toISOString() });
		expect(homeReadlistTarget(custom, [])).toBeUndefined();
	});
});

describe("homeReadlistTargets", () => {
	it("targets every built-in and custom readlist except the current Home", () => {
		expect([...homeReadlistTargets(weekend, definitions).keys()]).toEqual([HAND_PICKED_SCOPE, DEFAULT_READLIST_SLUG]);
		expect([...homeReadlistTargets(HAND_PICKED_SCOPE, definitions).keys()]).toEqual([DEFAULT_READLIST_SLUG, weekend]);
	});
});

describe("setHomeReadlistPath", () => {
	it("carries a custom readlist's creation time and nothing for a built-in", () => {
		expect(setHomeReadlistPath({ slug: HAND_PICKED_SCOPE })).toBe("/queue/queues/~hand-picked/home");
		expect(setHomeReadlistPath({ slug: weekend, createdAt: createdAt.toISOString() }))
			.toBe(`/queue/queues/weekend/home?createdAt=${encodeURIComponent(createdAt.toISOString())}`);
	});
});
