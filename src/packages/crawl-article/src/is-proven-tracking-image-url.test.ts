import { extractThumbnailCandidates } from "./extract-thumbnail";
import { isProvenTrackingImageUrl } from "./is-proven-tracking-image-url";

describe("isProvenTrackingImageUrl", () => {
	it.each([
		["the Facebook pixel over HTTPS", "https://www.facebook.com/tr?id=1&ev=PageView"],
		["the Facebook pixel over HTTP", "http://www.facebook.com/tr?id=1&ev=PageView"],
		["the Facebook pixel with an explicit default HTTPS port", "https://www.facebook.com:443/tr?id=1"],
		["the Facebook pixel with an explicit default HTTP port", "http://www.facebook.com:80/tr?id=1"],
		["an upper-case Facebook host with a fragment", "HTTPS://WWW.FACEBOOK.COM/tr?id=2#fragment"],
		["the Facebook pixel with no query", "https://www.facebook.com/tr"],
		["the Hotstar page-view event with another query value", "https://hspx.hotstar.com/v1/events/track/cp_page_view?pi=another-value"],
		["the Akamai pixel on www.sec.gov", "https://www.sec.gov/akam/13/pixel_170f3c9f?a=example"],
		["the Akamai pixel on www.turkishairlines.com", "https://www.turkishairlines.com/akam/13/pixel_0a1b2c3d"],
		["a percent-encoded hostname that URL normalizes to the evidenced host", "https://www.faceboo%6B.com/tr?id=3"],
	])("excludes %s", (_case, url) => {
		expect(isProvenTrackingImageUrl(url)).toBe(true);
	});

	it.each([
		["a lookalike host ending in another domain", "https://www.facebook.com.evil.example/tr"],
		["the bare registrable domain", "https://facebook.com/tr"],
		["an unrelated Facebook subdomain", "https://m.facebook.com/tr"],
		["an unrelated host with /tr", "https://example.com/tr"],
		["user-info naming the evidenced host", "https://www.facebook.com@example.com/tr"],
		["a Facebook image whose path starts with tr", "https://www.facebook.com/trailing.png"],
		["a trailing slash after tr", "https://www.facebook.com/tr/"],
		["an upper-case path", "https://www.facebook.com/TR"],
		["a nested tr image", "https://www.facebook.com/images/tr.png"],
		["a Hotstar path with an extra segment", "https://hspx.hotstar.com/v1/events/track/cp_page_view/extra"],
		["a different Hotstar event route", "https://hspx.hotstar.com/v1/events/track/cp_click"],
		["an Akamai pixel with a file extension", "https://www.sec.gov/akam/13/pixel_170f3c9f.png"],
		["an Akamai pixel in a different directory", "https://www.sec.gov/akam/12/pixel_170f3c9f"],
		["an Akamai pixel suffix that is too short", "https://www.sec.gov/akam/13/pixel_170f3c9"],
		["an Akamai pixel suffix that is too long", "https://www.sec.gov/akam/13/pixel_170f3c9f0"],
		["an Akamai pixel suffix in upper case", "https://www.sec.gov/akam/13/pixel_170F3C9F"],
		["the Akamai path on another host", "https://example.com/akam/13/pixel_170f3c9f"],
		["a permitted image whose query carries an encoded tracker URL", "https://cdn.example.com/photo.jpg?ref=https%3A%2F%2Fwww.facebook.com%2Ftr%3Fid%3D1"],
		["an encoded path separator after tr", "https://www.facebook.com/tr%2F"],
		["a percent-encoded letter in the path", "https://www.facebook.com/%74r"],
		["a double-encoded path", "https://www.facebook.com/%2574r"],
		["a non-default port", "https://www.facebook.com:8443/tr"],
		["a trailing-dot host", "https://www.facebook.com./tr"],
		["a non-HTTP scheme on the evidenced host", "ftp://www.facebook.com/tr"],
		["a malformed URL", "not a url"],
		["a data: URL", "data:image/gif;base64,R0lGODlhAQABAAAAACw="],
		["a javascript: URL", "javascript:alert(1)"],
	])("allows %s", (_case, url) => {
		expect(isProvenTrackingImageUrl(url)).toBe(false);
	});

	it("excludes attributes that resolve to an evidenced endpoint: HTML-escaped query separators, protocol-relative and relative URLs", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="https://www.facebook.com/tr?id=4&amp;ev=PageView">
			</head><body>
				<img src="//www.facebook.com/tr?id=5">
				<img src="/tr?id=6">
				<img src="https://cdn.example.com/kept.png">
			</body></html>
		`;
		expect(extractThumbnailCandidates({ html, baseUrl: "https://www.facebook.com/some/page" }))
			.toEqual(["https://cdn.example.com/kept.png"]);
	});
});
