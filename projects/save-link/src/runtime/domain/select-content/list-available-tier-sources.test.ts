import { CandidateIdSchema } from "@packages/domain/article";
import { initListAvailableTierSources } from "./list-available-tier-sources";
import type { ReadTierSource } from "../../providers/article-store/read-tier-source";
import type { TierSource } from "./tier-source.types";

const cid = (id: string) => CandidateIdSchema.parse(id);

const tierZeroSource: TierSource = {
	tier: "tier-0",
	html: "<p>tier-0</p>",
	metadata: {
		title: "T",
		siteName: "s",
		excerpt: "e",
		wordCount: 1,
		estimatedReadTime: 1,
	},
};

const tierOneSource: TierSource = {
	tier: "tier-1",
	html: "<p>tier-1</p>",
	metadata: {
		title: "T",
		siteName: "s",
		excerpt: "e",
		wordCount: 1,
		estimatedReadTime: 1,
	},
};

describe("initListAvailableTierSources", () => {
	it("returns every tier whose source is present", async () => {
		const archiveSource: TierSource = { ...tierOneSource, tier: "tier-2" };
		const byTier: Record<TierSource["tier"], TierSource> = {
			"tier-0": tierZeroSource,
			"tier-1": tierOneSource,
			"tier-2": archiveSource,
		};
		const readTierSource: ReadTierSource = jest.fn(async ({ tier }) => byTier[tier]);
		const { listAvailableTierSources } = initListAvailableTierSources({ readTierSource });

		const result = await listAvailableTierSources("https://example.com/a");

		expect(result).toEqual([tierZeroSource, tierOneSource, archiveSource]);
	});

	it("filters out missing tiers", async () => {
		const readTierSource: ReadTierSource = jest.fn(async ({ tier }) =>
			tier === "tier-1" ? tierOneSource : undefined,
		);
		const { listAvailableTierSources } = initListAvailableTierSources({ readTierSource });

		const result = await listAvailableTierSources("https://example.com/a");

		expect(result).toEqual([tierOneSource]);
	});

	it("returns an empty list when no tier source exists", async () => {
		const readTierSource: ReadTierSource = jest.fn(async () => undefined);
		const { listAvailableTierSources } = initListAvailableTierSources({ readTierSource });

		const result = await listAvailableTierSources("https://example.com/a");

		expect(result).toEqual([]);
	});

	it("reads the named immutable candidates and preserves a distinct previous canonical", async () => {
		const calls: Parameters<ReadTierSource>[0][] = [];
		const readTierSource: ReadTierSource = async (params) => {
			calls.push(params);
			return params.candidateId === undefined ? undefined : { ...tierOneSource, metadata: { ...tierOneSource.metadata, id: params.candidateId } };
		};
		const { listAvailableTierSources } = initListAvailableTierSources({ readTierSource });
		const result = await listAvailableTierSources("https://example.com/a", { candidates: [{ id: cid("fresh"), tier: "tier-1" }], canonical: { id: cid("prior"), tier: "tier-1" } });
		expect(result.map((source) => source.metadata.id)).toEqual(["fresh", "prior"]);
		expect(calls).toContainEqual({ url: "https://example.com/a", tier: "tier-1", candidateId: cid("fresh") });
		expect(calls).toContainEqual({ url: "https://example.com/a", tier: "tier-1", candidateId: cid("prior") });
	});

	it("deduplicates the same canonical candidate named in the event and current tier", async () => {
		const calls: Parameters<ReadTierSource>[0][] = [];
		const readTierSource: ReadTierSource = async (params) => { calls.push(params); return { ...tierOneSource, metadata: { ...tierOneSource.metadata, id: cid("same") } }; };
		const { listAvailableTierSources } = initListAvailableTierSources({ readTierSource });
		expect(await listAvailableTierSources("https://example.com/a", { candidates: [{ id: cid("same"), tier: "tier-1" }], canonical: { id: cid("same"), tier: "tier-1" } })).toHaveLength(1);
		expect(calls.filter((call) => call.candidateId === "same")).toHaveLength(1);
		expect(await listAvailableTierSources("https://example.com/a", {})).toHaveLength(1);
	});
});
