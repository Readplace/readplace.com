import { sanitizeEmailHtml } from "./sanitize-email-html";

const NO_IMAGES: Record<string, string> = {};

describe("sanitizeEmailHtml", () => {
	it("discards script tags and their content, keeping surrounding markup", () => {
		const result = sanitizeEmailHtml({
			html: '<p>Hi</p><script>alert("xss")</script>',
			rehostedImages: NO_IMAGES,
		});

		expect(result).toContain("<p>Hi</p>");
		expect(result).not.toContain("<script");
		expect(result).not.toContain("alert");
	});

	it("strips inline event handlers", () => {
		const result = sanitizeEmailHtml({
			html: '<p onclick="steal()">Hi</p>',
			rehostedImages: NO_IMAGES,
		});

		expect(result).toContain("<p>Hi</p>");
		expect(result).not.toContain("onclick");
	});

	it("removes the src of a remote image that was not rehosted so tracking beacons cannot fire", () => {
		const result = sanitizeEmailHtml({
			html: '<img src="https://tracker.test/beacon.gif" alt="beacon">',
			rehostedImages: NO_IMAGES,
		});

		expect(result).toContain("<img");
		expect(result).toContain('alt="beacon"');
		expect(result).not.toContain("tracker.test");
	});

	it("rewrites a rehosted remote image to its CDN https URL", () => {
		const cdnUrl = "https://cdn.test.readplace.com/content/email-images/abc123/0011223344556677.png";
		const result = sanitizeEmailHtml({
			html: '<img src="https://res.cloudinary.test/photo.png" alt="photo" width="640">',
			rehostedImages: { "https://res.cloudinary.test/photo.png": cdnUrl },
		});

		expect(result).toContain(`src="${cdnUrl}"`);
		expect(result).toContain('alt="photo"');
		expect(result).not.toContain("res.cloudinary.test");
	});

	it("rewrites a rehosted inline image to its inline data URI", () => {
		const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
		const result = sanitizeEmailHtml({
			html: '<img src="email://cid/logo@x" alt="logo">',
			rehostedImages: { "email://cid/logo@x": dataUri },
		});

		expect(result).toContain("data:image/png;base64,");
		expect(result).toContain('alt="logo"');
		expect(result).not.toContain("email://cid");
	});

	it("forces links to open safely in a new tab and drops javascript: hrefs", () => {
		const safe = sanitizeEmailHtml({
			html: '<a href="https://example.com/x">go</a>',
			rehostedImages: NO_IMAGES,
		});
		expect(safe).toContain('href="https://example.com/x"');
		expect(safe).toContain('target="_blank"');
		expect(safe).toContain('rel="noopener noreferrer"');

		const dangerous = sanitizeEmailHtml({
			html: '<a href="javascript:alert(1)">x</a>',
			rehostedImages: NO_IMAGES,
		});
		expect(dangerous).toContain(">x</a>");
		expect(dangerous).not.toContain("javascript:");
	});

	it("keeps allowlisted inline styles but drops dangerous ones", () => {
		const result = sanitizeEmailHtml({
			html: '<p style="color: #ffffff; position: fixed">x</p>',
			rehostedImages: NO_IMAGES,
		});

		expect(result).toContain("color");
		expect(result).not.toContain("position");
	});

	it("preserves allowlisted structural tags", () => {
		const result = sanitizeEmailHtml({
			html: "<ul><li>one</li><li>two</li></ul>",
			rehostedImages: NO_IMAGES,
		});

		expect(result).toBe("<ul><li>one</li><li>two</li></ul>");
	});

	it("closes the <xmp> raw-text bypass", () => {
		const result = sanitizeEmailHtml({
			html: "<p>ok</p><xmp></p><script>alert(1)</script></xmp>",
			rehostedImages: NO_IMAGES,
		});

		expect(result).toContain("<p>ok</p>");
		expect(result).not.toContain("<script");
		expect(result).not.toContain("alert");
	});
});
