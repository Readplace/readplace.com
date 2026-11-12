import assert from "node:assert/strict";
import { equivalentArticleUrls, toCanonicalArticleUrl } from "./canonical-article-url";
import { ArticleResourceUniqueId, canonicalIdentityOf } from "./index";

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

	const EMAIL_QUERY = "?midToken=AQExampleMid&otpToken=ZXhhbXBsZU90cA&trk=eml-email_example-update";

	it.each([
		["urn:li:activity:7000000000000000001", "urn:li:activity:7000000000000000001"],
		["urn:li:share:7000000000000000002", "urn:li:share:7000000000000000002"],
		["activity:7000000000000000003", "urn:li:activity:7000000000000000003"],
		["share:7000000000000000004", "urn:li:share:7000000000000000004"],
		["ugcPost:7000000000000000005", "urn:li:ugcPost:7000000000000000005"],
	])("saves a LinkedIn email link to post %s as the public post page without its sign-in tokens", (urn, postUrn) => {
		assert.equal(
			toCanonicalArticleUrl(`https://www.linkedin.com/comm/feed/update/${urn}${EMAIL_QUERY}`),
			`https://www.linkedin.com/feed/update/${postUrn}/`,
		);
	});

	it.each([
		`https://www.linkedin.com/comm/in/example-person${EMAIL_QUERY}`,
		"https://www.linkedin.com/comm/search/results/all/?keywords=example",
		`https://www.linkedin.com/comm/feed/update/urn:li:groupPost:7000000000000000006${EMAIL_QUERY}`,
	])("leaves the LinkedIn email link %s as it is", (url) => {
		assert.equal(toCanonicalArticleUrl(url), url);
	});

	it("saves a Nextdoor email post link as the public post page without its sign-in tokens", () => {
		assert.equal(
			toCanonicalArticleUrl("https://nextdoor.co.uk/p/ExamplePost123?share_token=dummyShare&auto_token=dummyAuto&ct=dummyCt"),
			"https://nextdoor.co.uk/p/ExamplePost123",
		);
	});
});

describe("personal link params in the article key", () => {
	it("saves a link carrying a HubSpot param under the clean URL", () => {
		assert.equal(
			toCanonicalArticleUrl("https://www.youtube.com/watch?v=abc123&_hsenc=p2ANqtz-placeholder&_hsmi=12345"),
			"https://www.youtube.com/watch?v=abc123",
		);
	});

	it("gives one identity to the same article saved with two different tokens and with none", () => {
		const post = "https://www.ai-supremacy.com/p/sample-post";

		assert.deepEqual(
			[`${post}?token=placeholder-a`, `${post}?token=placeholder-b`, post].map(canonicalIdentityOf),
			Array(3).fill(canonicalIdentityOf(post)),
		);
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

	it("lists a link carrying a personal param, then its clean link", () => {
		expect(equivalentArticleUrls("https://www.youtube.com/watch?v=abc123&_hsenc=p2ANqtz-placeholder")).toEqual([
			"https://www.youtube.com/watch?v=abc123&_hsenc=p2ANqtz-placeholder",
			"https://www.youtube.com/watch?v=abc123",
		]);
	});

	it("lists both hosts of a tweet's clean link after one carrying a personal param", () => {
		expect(equivalentArticleUrls("https://twitter.com/jack/status/20?mc_cid=placeholder")).toEqual([
			"https://twitter.com/jack/status/20?mc_cid=placeholder",
			"https://x.com/jack/status/20",
			"https://twitter.com/jack/status/20",
		]);
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
