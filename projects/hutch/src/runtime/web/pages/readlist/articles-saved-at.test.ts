import { articlesSavedAt } from "./articles-saved-at";

const legacy = { id: "legacy", url: "https://twitter.com/jack/status/20" };
const canonical = { id: "canonical", url: "https://x.com/jack/status/20" };
const other = { id: "other", url: "https://example.com/a" };

describe("articlesSavedAt", () => {
	it("finds the article saved at exactly the requested URL", () => {
		expect(articlesSavedAt({ articles: [other, canonical], url: "https://x.com/jack/status/20" })).toEqual([canonical]);
	});

	it("prefers a legacy twitter.com save over its x.com equivalent", () => {
		expect(articlesSavedAt({ articles: [canonical, legacy], url: legacy.url })).toEqual([legacy]);
	});

	it("finds the x.com save for a twitter.com tab when no twitter.com save exists", () => {
		expect(articlesSavedAt({ articles: [other, canonical], url: legacy.url })).toEqual([canonical]);
	});

	it("does not look past x.com for an x.com tab that was never saved", () => {
		expect(articlesSavedAt({ articles: [other, legacy], url: canonical.url })).toEqual([]);
	});

	it("finds nothing for a URL nobody saved", () => {
		expect(articlesSavedAt({ articles: [other], url: "https://example.com/b" })).toEqual([]);
	});
});
