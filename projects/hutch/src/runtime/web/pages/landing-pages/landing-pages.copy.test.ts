import { SHARED_LANDING_COPY_LAST_MODIFIED, landingPageLastModified } from "./landing-pages.copy";

describe("landingPageLastModified", () => {
	it("takes the page's own date when its copy changed after the shared copy", () => {
		expect(landingPageLastModified({ lastModified: "2999-01-01" })).toBe("2999-01-01");
	});

	it("takes the shared copy's date when the shared copy changed after the page", () => {
		expect(landingPageLastModified({ lastModified: "2000-01-01" })).toBe(
			SHARED_LANDING_COPY_LAST_MODIFIED,
		);
	});
});
