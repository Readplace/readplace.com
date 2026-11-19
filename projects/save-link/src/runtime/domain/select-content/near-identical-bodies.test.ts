import { bodiesAreNearIdentical } from "./near-identical-bodies";

const facts = (count: number) => Array.from({ length: count }, (_, index) => `<p>Fact ${index + 1} holds.</p>`).join("");
const IMG = '<img src="https://example.com/a.png">';
const longSentence = (words: number) => `<p>${"word ".repeat(words - 1)}end.</p>`;

describe("bodiesAreNearIdentical", () => {
	it("is true for the same body", () => {
		expect(bodiesAreNearIdentical({ fresh: facts(100), canonical: facts(100) })).toBe(true);
	});

	it("is true when exactly 0.99 of the sentences are shared", () => {
		expect(bodiesAreNearIdentical({ fresh: `${facts(99)}<p>Fact 100 holds today.</p>`, canonical: facts(100) })).toBe(true);
	});

	it("is false when 0.98 of the sentences are shared", () => {
		expect(bodiesAreNearIdentical({ fresh: `${facts(98)}<p>Fact 99 holds today.</p><p>Fact 100 holds today.</p>`, canonical: facts(100) })).toBe(false);
	});

	it("counts a repeated sentence once per occurrence", () => {
		expect(bodiesAreNearIdentical({ fresh: `${"<p>Repeated line.</p>".repeat(4)}${facts(99)}`, canonical: `<p>Repeated line.</p>${facts(99)}` })).toBe(false);
	});

	it("is true when the fresh body is exactly 50 words shorter", () => {
		expect(bodiesAreNearIdentical({ fresh: facts(200), canonical: `${facts(200)}${longSentence(50)}` })).toBe(true);
	});

	it("is false when the fresh body is 51 words shorter", () => {
		expect(bodiesAreNearIdentical({ fresh: facts(200), canonical: `${facts(200)}${longSentence(51)}` })).toBe(false);
	});

	it.each([
		{ media: "images", canonical: `${facts(100)}${IMG}${IMG}`, fresh: `${facts(100)}${IMG}` },
		{ media: "tables", canonical: `${facts(100)}<table><tr><td>Cell.</td></tr></table>`, fresh: `${facts(100)}<p>Cell.</p>` },
	])("is false when the fresh body renders fewer $media", ({ canonical, fresh }) => {
		expect(bodiesAreNearIdentical({ fresh, canonical })).toBe(false);
	});

	it("is true when the fresh body renders more images", () => {
		expect(bodiesAreNearIdentical({ fresh: `${facts(100)}${IMG}${IMG}${IMG}`, canonical: `${facts(100)}${IMG}${IMG}` })).toBe(true);
	});

	it("ignores an image the reader never renders", () => {
		expect(bodiesAreNearIdentical({ fresh: facts(100), canonical: `${facts(100)}<noscript>${IMG}</noscript>` })).toBe(true);
	});

	it("is false when a formula image became markup the reader drops", () => {
		expect(bodiesAreNearIdentical({
			fresh: `${facts(200)}<p>The ratio is <math><mi>x</mi></math> here.</p>`,
			canonical: `${facts(200)}<p>The ratio is <img src="https://wikimedia.org/api/rest_v1/media/math/render/svg/abc" alt="x"> here.</p>`,
		})).toBe(false);
	});

	it("is false for two bodies with no text", () => {
		expect(bodiesAreNearIdentical({ fresh: IMG, canonical: IMG })).toBe(false);
	});

	it("is true when two sentences are added to a long body, the accepted consent-banner blind spot", () => {
		expect(bodiesAreNearIdentical({ fresh: `<p>We value your privacy. Accept all cookies to continue.</p>${facts(200)}`, canonical: facts(200) })).toBe(true);
	});
});
