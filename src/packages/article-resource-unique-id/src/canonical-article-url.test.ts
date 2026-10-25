import { equivalentArticleUrls, toCanonicalArticleUrl } from "./canonical-article-url";
import { ArticleResourceUniqueId } from "./index";

const SHORT = "https://www.amazon.com.au/dp/1492043451?ref_=mr_direct_us_au_au&showmri";
const TITLE = "https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451";
const BARE = "https://www.amazon.com.au/dp/1492043451";

describe("toCanonicalArticleUrl", () => {
	it.each([SHORT, TITLE])("saves %s as the bare product link", (url) => {
		expect(toCanonicalArticleUrl(url)).toBe(BARE);
	});

	it("still saves a twitter.com link as its x.com spelling", () => {
		expect(toCanonicalArticleUrl("https://twitter.com/jack/status/20")).toBe("https://x.com/jack/status/20");
	});
});

describe("equivalentArticleUrls", () => {
	it("lists a title link, then its bare link", () => {
		expect(equivalentArticleUrls(TITLE)).toEqual([TITLE, BARE]);
	});

	it("lists a bare link alone", () => {
		expect(equivalentArticleUrls(BARE)).toEqual([BARE]);
	});

	it("lists an http bare link with its https form, which share one key", () => {
		const httpBare = "http://www.amazon.com.au/dp/1492043451";

		expect(equivalentArticleUrls(httpBare)).toEqual([httpBare, BARE]);
		expect(ArticleResourceUniqueId.parse(httpBare).value).toBe(ArticleResourceUniqueId.parse(BARE).value);
	});

	it("still lists both hosts for a tweet", () => {
		expect(equivalentArticleUrls("https://twitter.com/jack/status/20")).toEqual([
			"https://x.com/jack/status/20",
			"https://twitter.com/jack/status/20",
		]);
	});
});

describe("ArticleResourceUniqueId.parse of an Amazon title link", () => {
	it("keeps the title key, so stored rows stay valid", () => {
		expect(ArticleResourceUniqueId.parse(TITLE).value).toBe(
			"www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451",
		);
	});
});
