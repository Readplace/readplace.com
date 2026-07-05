import { resolvePostSignupRedirect } from "./post-signup-redirect";

const ARTICLE_URL = "https://example.com/post";
const AUTOSAVE = `/queue?url=${encodeURIComponent(ARTICLE_URL)}&utm_source=signup-autosave`;

describe("resolvePostSignupRedirect", () => {
	it("honours an explicit returnUrl and never auto-saves, even when a lastViewUrl is present", () => {
		expect(
			resolvePostSignupRedirect({ returnUrl: "/oauth/authorize?client_id=test", lastViewUrl: ARTICLE_URL }),
		).toBe("/oauth/authorize?client_id=test");
	});

	it("falls back to /queue when there is neither a returnUrl nor a lastViewUrl", () => {
		expect(resolvePostSignupRedirect({ returnUrl: undefined, lastViewUrl: undefined })).toBe("/queue");
	});

	it("auto-saves the last-viewed article when there is no explicit returnUrl", () => {
		expect(resolvePostSignupRedirect({ returnUrl: undefined, lastViewUrl: ARTICLE_URL })).toBe(AUTOSAVE);
	});

	it("carries the utm_source marker and url-encodes the article url", () => {
		const location = resolvePostSignupRedirect({ returnUrl: undefined, lastViewUrl: ARTICLE_URL });
		const params = new URL(location, "http://localhost").searchParams;
		expect(params.get("url")).toBe(ARTICLE_URL);
		expect(params.get("utm_source")).toBe("signup-autosave");
	});

	it.each([
		["a non-url", "not a url"],
		["a javascript: scheme", "javascript:alert(1)"],
		["a loopback address", "http://localhost"],
	])("ignores %s lastViewUrl and falls back to /queue", (_label, tampered) => {
		expect(resolvePostSignupRedirect({ returnUrl: undefined, lastViewUrl: tampered })).toBe("/queue");
	});
});
