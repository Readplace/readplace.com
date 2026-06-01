import { tiersDifferInMedia } from "./tiers-differ-in-media";
import type { TierSource } from "./tier-source.types";

function source(html: string): TierSource {
	return {
		tier: "tier-0",
		html,
		metadata: { title: "", siteName: "", excerpt: "", wordCount: 0, estimatedReadTime: 0 },
	};
}

describe("tiersDifferInMedia", () => {
	it("is false when candidates carry the same media URLs regardless of order or surrounding prose", () => {
		const result = tiersDifferInMedia([
			source('<p>one</p><img src="https://cdn.test/a.png"><img src="https://cdn.test/b.png">'),
			source('<img src="https://cdn.test/b.png"><p>different prose</p><img src="https://cdn.test/a.png">'),
		]);

		expect(result).toBe(false);
	});

	it("is false when neither candidate has media", () => {
		expect(tiersDifferInMedia([source("<p>one</p>"), source("<p>two</p>")])).toBe(false);
	});

	it("is true when a candidate's image URL changed", () => {
		const result = tiersDifferInMedia([
			source('<img src="https://cdn.test/old.png">'),
			source('<img src="https://cdn.test/new.png">'),
		]);

		expect(result).toBe(true);
	});

	it("detects srcset changes, not just src", () => {
		const result = tiersDifferInMedia([
			source('<img srcset="https://cdn.test/a.png 1x">'),
			source('<img srcset="https://cdn.test/a.png 1x, https://cdn.test/b.png 2x">'),
		]);

		expect(result).toBe(true);
	});
});
