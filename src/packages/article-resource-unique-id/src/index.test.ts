import { ArticleResourceUniqueId } from "./index";

describe("ArticleResourceUniqueId.parse", () => {
	it("strips https scheme", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/article").value).toBe("example.com/article");
	});

	it("strips http scheme", () => {
		expect(ArticleResourceUniqueId.parse("http://example.com/article").value).toBe("example.com/article");
	});

	it("strips fragment", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/article#heading").value).toBe("example.com/article");
	});

	it("preserves non-tracking query params and sorts them alphabetically", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/path?q=1&page=2").value).toBe("example.com/path?page=2&q=1");
	});

	it("strips tracking params so the same article with or without utm_* produces one canonical id", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/article?utm_source=twitter").value).toBe("example.com/article");
		expect(ArticleResourceUniqueId.parse("https://example.com/article?utm_source=twitter").value)
			.toBe(ArticleResourceUniqueId.parse("https://example.com/article").value);
	});

	it("preserves non-default port", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com:8080/path").value).toBe("example.com:8080/path");
	});

	it("omits default https port 443", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com:443/path").value).toBe("example.com/path");
	});

	it("omits default http port 80", () => {
		expect(ArticleResourceUniqueId.parse("http://example.com:80/path").value).toBe("example.com/path");
	});

	it("handles root path", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/").value).toBe("example.com/");
	});

	it("handles root path without trailing slash", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com").value).toBe("example.com/");
	});

	it("produces same ID regardless of scheme", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/article").value).toBe(ArticleResourceUniqueId.parse("http://example.com/article").value);
	});
});

describe("ArticleResourceUniqueId.toS3ContentKey", () => {
	it("produces the canonical S3 content key", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/blog/post").toS3ContentKey())
			.toBe("content/example.com%2Fblog%2Fpost/content.html");
	});

	it("encodes query string characters (after tracking strip + alphabetical sort)", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/path?q=1&page=2").toS3ContentKey())
			.toBe("content/example.com%2Fpath%3Fpage%3D2%26q%3D1/content.html");
	});

	it("encodes colon in port", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com:8080/path").toS3ContentKey())
			.toBe("content/example.com%3A8080%2Fpath/content.html");
	});

	it("encodes unicode characters in path", () => {
		/** The URL parser pre-encodes `é` to `%C3%A9` in pathname, so `encodeURIComponent` re-escapes `%` to `%25`. */
		expect(ArticleResourceUniqueId.parse("https://example.com/café").toS3ContentKey())
			.toBe("content/example.com%2Fcaf%25C3%25A9/content.html");
	});

	it("matches between save (write) and read sides for the same URL", () => {
		const write = ArticleResourceUniqueId.parse("https://example.com/article").toS3ContentKey();
		const read = ArticleResourceUniqueId.parse("http://example.com/article").toS3ContentKey();
		expect(write).toBe(read);
	});
});

describe("ArticleResourceUniqueId.toS3ImageKey", () => {
	it("produces the image S3 key under the content prefix", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/blog/post").toS3ImageKey("abc123.png"))
			.toBe("content/example.com%2Fblog%2Fpost/images/abc123.png");
	});

	it("encodes the id but not the filename", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com:8080/path").toS3ImageKey("hash.jpg"))
			.toBe("content/example.com%3A8080%2Fpath/images/hash.jpg");
	});
});

describe("ArticleResourceUniqueId.toImageCdnUrl", () => {
	it("double-encodes the id so the CDN URL decodes to the S3 key", () => {
		const id = ArticleResourceUniqueId.parse("https://example.com/blog/post");
		const url = id.toImageCdnUrl({ baseUrl: "https://cdn.example", filename: "abc123.png" });
		expect(url).toBe("https://cdn.example/content/example.com%252Fblog%252Fpost/images/abc123.png");
	});

	it("URL path decodes once to match the S3 image key", () => {
		const id = ArticleResourceUniqueId.parse("https://example.com/article");
		const key = id.toS3ImageKey("hash.png");
		const url = id.toImageCdnUrl({ baseUrl: "https://cdn.example", filename: "hash.png" });
		const urlPath = new URL(url).pathname;
		expect(decodeURIComponent(urlPath.replace(/^\//, ""))).toBe(key);
	});
});

describe("ArticleResourceUniqueId.toString", () => {
	it("toString returns the normalized value", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/path").toString()).toBe("example.com/path");
	});

	it("interpolates as the normalized value in template literals", () => {
		expect(`${ArticleResourceUniqueId.parse("https://example.com/path")}`).toBe("example.com/path");
	});
});

describe("ArticleResourceUniqueId.toS3PendingHtmlKey", () => {
	it("produces the canonical S3 pending-html key", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/blog/post").toS3PendingHtmlKey())
			.toBe("pending-html/example.com%2Fblog%2Fpost.html");
	});

	it("encodes colon in port", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com:8080/path").toS3PendingHtmlKey())
			.toBe("pending-html/example.com%3A8080%2Fpath.html");
	});

	it("matches between write and read sides for the same URL regardless of scheme", () => {
		const write = ArticleResourceUniqueId.parse("https://example.com/article").toS3PendingHtmlKey();
		const read = ArticleResourceUniqueId.parse("http://example.com/article").toS3PendingHtmlKey();
		expect(write).toBe(read);
	});
});

describe("ArticleResourceUniqueId.toS3SourceKey", () => {
	it("produces the canonical S3 source key for a tier", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/blog/post").toS3SourceKey({ tier: "tier-0" }))
			.toBe("articles/example.com%2Fblog%2Fpost/sources/tier-0.html");
	});

	it("encodes the id but not the tier", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com:8080/path").toS3SourceKey({ tier: "tier-1" }))
			.toBe("articles/example.com%3A8080%2Fpath/sources/tier-1.html");
	});

	it("matches between write and read sides for the same URL regardless of scheme", () => {
		const write = ArticleResourceUniqueId.parse("https://example.com/article").toS3SourceKey({ tier: "tier-0" });
		const read = ArticleResourceUniqueId.parse("http://example.com/article").toS3SourceKey({ tier: "tier-0" });
		expect(write).toBe(read);
	});
});
