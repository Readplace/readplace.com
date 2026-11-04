import assert from "node:assert/strict";
import { withoutPersonalLinkParams } from "./personal-link-params";

describe("withoutPersonalLinkParams", () => {
	it("removes HubSpot params on any host, keeping the rest of the URL", () => {
		assert.equal(
			withoutPersonalLinkParams("https://www.youtube.com/watch?v=abc123&_hsenc=p2ANqtz-placeholder&_hsmi=12345&t=30"),
			"https://www.youtube.com/watch?v=abc123&t=30",
		);
	});

	it("removes Mailchimp params on any host", () => {
		assert.equal(
			withoutPersonalLinkParams("https://news.example.com/story?mc_cid=placeholder1&mc_eid=placeholder2"),
			"https://news.example.com/story",
		);
	});

	it.each(["https://quora.com/some-question?qv_src=email", "https://sample-space.quora.com/some-post?qv_src=email"])(
		"removes qv_src from %s",
		(url) => {
			assert.equal(withoutPersonalLinkParams(url), url.replace("?qv_src=email", ""));
		},
	);

	it.each(["https://example.com/some-post?qv_src=email", "https://notquora.com/some-post?qv_src=email"])(
		"keeps qv_src on %s",
		(url) => {
			assert.equal(withoutPersonalLinkParams(url), url);
		},
	);

	it("removes token on www.ai-supremacy.com, keeping the other params", () => {
		assert.equal(
			withoutPersonalLinkParams("https://www.ai-supremacy.com/p/sample-post?token=placeholder&action=like&submitLike=true"),
			"https://www.ai-supremacy.com/p/sample-post?action=like&submitLike=true",
		);
	});

	it("keeps token on another host", () => {
		const url = "https://example.com/p/sample-post?token=placeholder";

		assert.equal(withoutPersonalLinkParams(url), url);
	});

	it("returns a URL with no named param as the identical string, even when URL.href would re-encode it", () => {
		const url = "https://EXAMPLE.com/a b?q=x y&img=photo.png";
		assert.notEqual(new URL(url).href, url);

		assert.equal(withoutPersonalLinkParams(url), url);
	});

	it("returns an unparseable URL as it went in", () => {
		assert.equal(withoutPersonalLinkParams("not a url?_hsenc=placeholder"), "not a url?_hsenc=placeholder");
	});
});
