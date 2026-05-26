import { extractFirstThumbnailUrl, extractThumbnailCandidates } from "./extract-thumbnail";

describe("extractFirstThumbnailUrl", () => {
	it("returns the og:image URL when present", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="https://example.com/og.png">
				<meta name="twitter:image" content="https://example.com/twitter.png">
			</head><body><img src="https://example.com/body.png"></body></html>
		`;
		expect(extractFirstThumbnailUrl({ html, baseUrl: "https://example.com/article" }))
			.toBe("https://example.com/og.png");
	});

	it("falls back to twitter:image when og:image is missing", () => {
		const html = `
			<html><head>
				<meta name="twitter:image" content="https://example.com/twitter.png">
			</head><body><img src="https://example.com/body.png"></body></html>
		`;
		expect(extractFirstThumbnailUrl({ html, baseUrl: "https://example.com/article" }))
			.toBe("https://example.com/twitter.png");
	});

	it("falls back to the first <img> when both meta tags are missing", () => {
		const html = `
			<html><head></head><body>
				<img src="https://example.com/first.png">
				<img src="https://example.com/second.png">
			</body></html>
		`;
		expect(extractFirstThumbnailUrl({ html, baseUrl: "https://example.com/article" }))
			.toBe("https://example.com/first.png");
	});

	it("resolves relative og:image URLs against the article base URL", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="/images/hero.png">
			</head><body></body></html>
		`;
		expect(extractFirstThumbnailUrl({ html, baseUrl: "https://blog.example.com/post" }))
			.toBe("https://blog.example.com/images/hero.png");
	});

	it("returns null when the document has no usable image", () => {
		const html = `<html><head><title>No images</title></head><body><p>Text only.</p></body></html>`;
		expect(extractFirstThumbnailUrl({ html, baseUrl: "https://example.com/article" }))
			.toBeNull();
	});

	it("skips non-http(s) URLs (data:, javascript:, mailto:)", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="data:image/png;base64,iVBORw0KG...">
			</head><body>
				<img src="https://example.com/real.png">
			</body></html>
		`;
		expect(extractFirstThumbnailUrl({ html, baseUrl: "https://example.com/article" }))
			.toBe("https://example.com/real.png");
	});

	it("returns null for relative URLs when baseUrl is omitted and the URL cannot be validated as http(s)", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="/images/hero.png">
			</head><body></body></html>
		`;
		expect(extractFirstThumbnailUrl({ html })).toBeNull();
	});
});

describe("extractThumbnailCandidates", () => {
	it("returns all candidates in og:image → twitter:image → <img> order", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="https://example.com/og.png">
				<meta name="twitter:image" content="https://example.com/twitter.png">
			</head><body>
				<img src="https://example.com/body-1.png">
				<img src="https://example.com/body-2.png">
			</body></html>
		`;
		expect(extractThumbnailCandidates({ html, baseUrl: "https://example.com/article" }))
			.toEqual([
				"https://example.com/og.png",
				"https://example.com/twitter.png",
				"https://example.com/body-1.png",
				"https://example.com/body-2.png",
			]);
	});

	it("dedupes identical URLs across the cascade", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="https://example.com/shared.png">
				<meta name="twitter:image" content="https://example.com/shared.png">
			</head><body>
				<img src="https://example.com/shared.png">
			</body></html>
		`;
		expect(extractThumbnailCandidates({ html, baseUrl: "https://example.com/article" }))
			.toEqual(["https://example.com/shared.png"]);
	});

	it("returns an empty array when no candidates are present", () => {
		const html = `<html><head></head><body><p>Text only.</p></body></html>`;
		expect(extractThumbnailCandidates({ html })).toEqual([]);
	});
});
