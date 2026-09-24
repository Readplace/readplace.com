import { combineInboxLinkSaveStates, inboxSavedLinkKey, inboxSavedLinkLookupKeys } from "./inbox-saved-link.types";

describe("inboxSavedLinkKey", () => {
	it("collapses tracking params so a save and a lookup of the same link agree", () => {
		expect(inboxSavedLinkKey("https://example.com/post?utm_source=news&utm_medium=email")).toBe(
			inboxSavedLinkKey("https://example.com/post"),
		);
	});

	it("ignores the scheme, so an http and an https save are one link", () => {
		expect(inboxSavedLinkKey("http://example.com/post")).toBe(
			inboxSavedLinkKey("https://example.com/post"),
		);
	});

	it("keeps a meaningful query param that identifies the article", () => {
		expect(inboxSavedLinkKey("https://example.com/read?id=42")).not.toBe(
			inboxSavedLinkKey("https://example.com/read?id=43"),
		);
	});

	it("keeps distinct paths on one host apart", () => {
		expect(inboxSavedLinkKey("https://example.com/one")).not.toBe(
			inboxSavedLinkKey("https://example.com/two"),
		);
	});

	it("throws on a value that is not a url", () => {
		expect(() => inboxSavedLinkKey("not a url")).toThrow();
	});
});

describe("inboxSavedLinkLookupKeys", () => {
	const onX = inboxSavedLinkKey("https://x.com/jack/status/20");
	const onTwitter = inboxSavedLinkKey("https://twitter.com/jack/status/20");

	it("looks a tweet up under its x.com key, then its twitter.com key, whichever host the link used", () => {
		expect(inboxSavedLinkLookupKeys("https://twitter.com/jack/status/20")).toEqual([onX, onTwitter]);
		expect(inboxSavedLinkLookupKeys("https://x.com/jack/status/20")).toEqual([onX, onTwitter]);
	});

	it.each(["https://example.com/post", "https://mobile.twitter.com/jack/status/20", "https://twitter.com:8443/jack/status/20"])(
		"looks %s up under its own key only",
		(url) => {
			expect(inboxSavedLinkLookupKeys(url)).toEqual([inboxSavedLinkKey(url)]);
		},
	);

	it("throws on a value that is not a url", () => {
		expect(() => inboxSavedLinkLookupKeys("not a url")).toThrow();
	});
});

describe("combineInboxLinkSaveStates", () => {
	it.each([
		[["saved", "failed"], "saved"],
		[["failed", "saved"], "saved"],
		[[undefined, "saved"], "saved"],
		[[undefined, "failed"], "failed"],
		[["failed", undefined], "failed"],
		[[undefined, undefined], undefined],
		[[], undefined],
	] as const)("combines %j into %s", (states, combined) => {
		expect(combineInboxLinkSaveStates(states)).toBe(combined);
	});
});
