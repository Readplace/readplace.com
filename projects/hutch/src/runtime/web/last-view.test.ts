import { LAST_VIEW_COOKIE_NAME, consumeLastViewUrl, readLastViewUrl } from "./last-view";

const ARTICLE_URL = "https://example.com/post";

function recordingRes(): {
	res: { clearCookie: (name: string, options: { path: string }) => void };
	cleared: { name: string; options: { path: string } }[];
} {
	const cleared: { name: string; options: { path: string } }[] = [];
	return {
		res: { clearCookie: (name, options) => { cleared.push({ name, options }); } },
		cleared,
	};
}

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

describe("consumeLastViewUrl", () => {
	it("returns the url and clears the cookie so it auto-saves exactly once", () => {
		const { res, cleared } = recordingRes();

		const url = consumeLastViewUrl({ req: { cookies: { [LAST_VIEW_COOKIE_NAME]: ARTICLE_URL } }, res });

		expect(url).toBe(ARTICLE_URL);
		expect(cleared).toEqual([{ name: LAST_VIEW_COOKIE_NAME, options: { path: "/" } }]);
	});

	it("clears the cookie even when none is present so a stale value cannot linger", () => {
		const { res, cleared } = recordingRes();

		const url = consumeLastViewUrl({ req: { cookies: {} }, res });

		expect(url).toBeUndefined();
		expect(cleared).toEqual([{ name: LAST_VIEW_COOKIE_NAME, options: { path: "/" } }]);
	});
});
