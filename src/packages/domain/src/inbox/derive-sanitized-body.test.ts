import { deriveSanitizedBody } from "./derive-sanitized-body";

describe("deriveSanitizedBody", () => {
	it("inlines a cid image as a data URI and strips remote images", () => {
		const html = deriveSanitizedBody({
			html: '<p><img src="email://cid/logo@x"></p><img src="https://tracker.test/p.gif">',
			inlineImages: [{ cid: "logo@x", contentType: "image/png", body: Buffer.from([1, 2, 3]) }],
			rehostedRemoteImages: {},
		});

		expect(html).toContain("data:image/png;base64,AQID");
		expect(html).not.toContain("tracker.test");
		expect(html).not.toContain("email://cid");
	});

	it("keeps a rehosted remote image's CDN src while stripping unrehosted remote images", () => {
		const cdnUrl = "https://cdn.test.readplace.com/content/email-images/abc123/aabbccddeeff0011.jpg";
		const html = deriveSanitizedBody({
			html: '<img src="https://newsletter.test/hero.jpg"><img src="https://tracker.test/p.gif">',
			inlineImages: [],
			rehostedRemoteImages: { "https://newsletter.test/hero.jpg": cdnUrl },
		});

		expect(html).toContain(`src="${cdnUrl}"`);
		expect(html).not.toContain("newsletter.test");
		expect(html).not.toContain("tracker.test");
	});

	it("matches a rehost map key against the entity-decoded src attribute", () => {
		const cdnUrl = "https://cdn.test.readplace.com/content/email-images/abc123/0102030405060708.png";
		const html = deriveSanitizedBody({
			html: '<img src="https://newsletter.test/i.png?a=1&amp;b=2">',
			inlineImages: [],
			rehostedRemoteImages: { "https://newsletter.test/i.png?a=1&b=2": cdnUrl },
		});

		expect(html).toContain("cdn.test.readplace.com");
	});

	it("returns sanitized HTML for a plain body with no inline images", () => {
		const html = deriveSanitizedBody({
			html: "<p>Just text</p><script>alert(1)</script>",
			inlineImages: [],
			rehostedRemoteImages: {},
		});

		expect(html).toContain("<p>Just text</p>");
		expect(html).not.toContain("<script");
	});

	it("returns an empty string when sanitizing leaves nothing renderable", () => {
		const html = deriveSanitizedBody({
			html: "<style>p{color:red}</style><script>alert(1)</script>",
			inlineImages: [],
			rehostedRemoteImages: {},
		});

		expect(html).toBe("");
	});
});
