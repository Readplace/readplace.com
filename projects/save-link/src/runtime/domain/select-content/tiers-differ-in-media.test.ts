import { tiersDifferInMedia } from "./tiers-differ-in-media";
import type { TierSource } from "@packages/tier-source";

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

	describe("for images stored under a save attempt's path", () => {
		const firstAttempt = "a".repeat(32);
		const secondAttempt = "b".repeat(32);
		const sameBytes = "c".repeat(32);
		const changedBytes = "d".repeat(32);
		const cdnImage = (params: { attempt: string; bytes: string }) =>
			`https://cdn.test/content/article-id/images/attempts/${params.attempt}/${params.bytes}.png`;

		it("is false when src differs only by the attempt", () => {
			const result = tiersDifferInMedia([
				source(`<img src="${cdnImage({ attempt: firstAttempt, bytes: sameBytes })}">`),
				source(`<img src="${cdnImage({ attempt: secondAttempt, bytes: sameBytes })}">`),
			]);

			expect(result).toBe(false);
		});

		it("is false when srcset differs only by the attempt", () => {
			const result = tiersDifferInMedia([
				source(`<img srcset="${cdnImage({ attempt: firstAttempt, bytes: sameBytes })} 1x">`),
				source(`<img srcset="${cdnImage({ attempt: secondAttempt, bytes: sameBytes })} 1x">`),
			]);

			expect(result).toBe(false);
		});

		it("is true when the same attempt wrote different image bytes", () => {
			const result = tiersDifferInMedia([
				source(`<img src="${cdnImage({ attempt: firstAttempt, bytes: sameBytes })}">`),
				source(`<img src="${cdnImage({ attempt: firstAttempt, bytes: changedBytes })}">`),
			]);

			expect(result).toBe(true);
		});
	});
});
