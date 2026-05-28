import { resolveCanonicalImageUrl } from "./resolve-canonical-image-url";
import type { TierSource } from "./tier-source.types";

function source(overrides: { tier: TierSource["tier"]; imageUrl?: string }): TierSource {
	return {
		tier: overrides.tier,
		html: "<p>x</p>",
		metadata: {
			title: "t",
			siteName: "s",
			excerpt: "e",
			wordCount: 1,
			estimatedReadTime: 1,
			imageUrl: overrides.imageUrl,
		},
	};
}

describe("resolveCanonicalImageUrl", () => {
	it("returns the winner's imageUrl when the winner has one", () => {
		const winner = source({ tier: "tier-1", imageUrl: "https://example.com/winner.png" });
		const loser = source({ tier: "tier-0", imageUrl: "https://example.com/loser.png" });
		expect(resolveCanonicalImageUrl({ winner, candidates: [loser, winner] }))
			.toBe("https://example.com/winner.png");
	});

	it("falls back to another candidate's imageUrl when the winner has none", () => {
		const winner = source({ tier: "tier-0" });
		const loser = source({ tier: "tier-1", imageUrl: "https://example.com/loser.png" });
		expect(resolveCanonicalImageUrl({ winner, candidates: [winner, loser] }))
			.toBe("https://example.com/loser.png");
	});

	it("returns undefined when no candidate has an imageUrl", () => {
		const winner = source({ tier: "tier-0" });
		const loser = source({ tier: "tier-1" });
		expect(resolveCanonicalImageUrl({ winner, candidates: [winner, loser] }))
			.toBeUndefined();
	});

	it("returns the first non-null imageUrl in the candidate list when the winner has none and multiple candidates do", () => {
		const winner = source({ tier: "tier-0" });
		const first = source({ tier: "tier-1", imageUrl: "https://example.com/first.png" });
		const second = source({ tier: "tier-1", imageUrl: "https://example.com/second.png" });
		expect(resolveCanonicalImageUrl({ winner, candidates: [winner, first, second] }))
			.toBe("https://example.com/first.png");
	});
});
