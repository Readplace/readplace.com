import { deriveSanitizedBody } from "./derive-sanitized-body";

describe("deriveSanitizedBody", () => {
	it("inlines a cid image as a data URI and strips remote images", () => {
		const html = deriveSanitizedBody({
			html: '<p><img src="email://cid/logo@x"></p><img src="https://tracker.test/p.gif">',
			inlineImages: [{ cid: "logo@x", contentType: "image/png", body: Buffer.from([1, 2, 3]) }],
		});

		expect(html).toContain("data:image/png;base64,AQID");
		expect(html).not.toContain("tracker.test");
		expect(html).not.toContain("email://cid");
	});

	it("returns sanitized HTML for a plain body with no inline images", () => {
		const html = deriveSanitizedBody({
			html: "<p>Just text</p><script>alert(1)</script>",
			inlineImages: [],
		});

		expect(html).toContain("<p>Just text</p>");
		expect(html).not.toContain("<script");
	});

	it("returns an empty string when sanitizing leaves nothing renderable", () => {
		const html = deriveSanitizedBody({
			html: "<style>p{color:red}</style><script>alert(1)</script>",
			inlineImages: [],
		});

		expect(html).toBe("");
	});
});
