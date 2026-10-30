import { resolveCanonicalPublishedOn } from "./resolve-canonical-published-on";
import type { TierSource } from "./tier-source.types";

function source(overrides: { tier: TierSource["tier"]; publishedOn?: string }): TierSource {
	return {
		tier: overrides.tier,
		html: "<p>x</p>",
		metadata: {
			title: "t",
			siteName: "s",
			excerpt: "e",
			wordCount: 1,
			estimatedReadTime: 1,
			publishedOn: overrides.publishedOn,
		},
	};
}

describe("resolveCanonicalPublishedOn", () => {
	it("returns the winner's publish date when the winner has one", () => {
		const winner = source({ tier: "tier-1", publishedOn: "2025-10-08" });
		const loser = source({ tier: "tier-0", publishedOn: "2024-01-01" });
		expect(resolveCanonicalPublishedOn({ winner, candidates: [loser, winner] })).toBe("2025-10-08");
	});

	it("rescues the publish date from a losing candidate when the winner has none", () => {
		const winner = source({ tier: "tier-0" });
		const loser = source({ tier: "tier-1", publishedOn: "2025-10-08" });
		expect(resolveCanonicalPublishedOn({ winner, candidates: [winner, loser] })).toBe("2025-10-08");
	});

	it("returns the first candidate's publish date when the winner has none and several candidates do", () => {
		const winner = source({ tier: "tier-0" });
		const first = source({ tier: "tier-1", publishedOn: "2025-10-08" });
		const second = source({ tier: "tier-1", publishedOn: "2024-01-01" });
		expect(resolveCanonicalPublishedOn({ winner, candidates: [winner, first, second] })).toBe("2025-10-08");
	});

	it("returns undefined when no candidate has a publish date", () => {
		const winner = source({ tier: "tier-0" });
		const loser = source({ tier: "tier-1" });
		expect(resolveCanonicalPublishedOn({ winner, candidates: [winner, loser] })).toBeUndefined();
	});

	it("keeps a decades-old publish date", () => {
		const winner = source({ tier: "tier-1", publishedOn: "1946-08-31" });
		expect(resolveCanonicalPublishedOn({ winner, candidates: [winner] })).toBe("1946-08-31");
	});
});
