import { LAST_VIEW_COOKIE_NAME, readLastViewUrl } from "./last-view";

const ARTICLE_URL = "https://example.com/post";

describe("readLastViewUrl", () => {
	it("returns the url from a present cookie", () => {
		expect(readLastViewUrl({ cookies: { [LAST_VIEW_COOKIE_NAME]: ARTICLE_URL } })).toBe(ARTICLE_URL);
	});

	it("returns undefined when there is no cookie jar", () => {
		expect(readLastViewUrl({})).toBeUndefined();
	});

	it("returns undefined when the cookie is absent", () => {
		expect(readLastViewUrl({ cookies: {} })).toBeUndefined();
	});

	it("treats a non-string cookie as absent", () => {
		expect(readLastViewUrl({ cookies: { [LAST_VIEW_COOKIE_NAME]: 42 } })).toBeUndefined();
	});
});
