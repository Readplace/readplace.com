import { initListAvailableTierSources } from "./list-available-tier-sources";
import type { ReadTierSource } from "../../providers/article-store/read-tier-source";
import type { TierSource } from "./tier-source.types";

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
});
