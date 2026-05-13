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
	it("returns both tiers when both sources are present", async () => {
		const readTierSource: ReadTierSource = jest.fn(async ({ tier }) =>
			tier === "tier-0" ? tierZeroSource : tierOneSource,
		);
		const { listAvailableTierSources } = initListAvailableTierSources({ readTierSource });

		const result = await listAvailableTierSources("https://example.com/a");

		expect(result).toEqual([tierZeroSource, tierOneSource]);
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
