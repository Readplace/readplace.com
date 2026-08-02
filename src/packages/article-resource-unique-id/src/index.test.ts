import { ArticleResourceUniqueId, toCrawlVersionMinuteId } from "./index";

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

describe("ArticleResourceUniqueId.toS3PendingPdfKey", () => {
	it("produces the canonical S3 pending-pdf key", () => {
		expect(ArticleResourceUniqueId.parse("https://example.com/doc.pdf").toS3PendingPdfKey())
			.toBe("pending-pdf/example.com%2Fdoc.pdf.pdf");
	});

	it("matches between write and read sides for the same URL regardless of scheme", () => {
		const write = ArticleResourceUniqueId.parse("https://example.com/doc.pdf").toS3PendingPdfKey();
		const read = ArticleResourceUniqueId.parse("http://example.com/doc.pdf").toS3PendingPdfKey();
		expect(write).toBe(read);
	});
});

describe("ArticleResourceUniqueId.toS3ContentVersionKey", () => {
	it("nests the version snapshot under a minute-id folder with the colon replaced by a hyphen", () => {
		expect(
			ArticleResourceUniqueId.parse("https://example.com/blog/post").toS3ContentVersionKey({
				minuteId: "2026-07-10T09:41Z",
			}),
		).toBe("content-versions/example.com%2Fblog%2Fpost/2026-07-10T09-41Z/content.html");
	});

	it("encodes the id but keeps the minute-id folder legible", () => {
		expect(
			ArticleResourceUniqueId.parse("https://example.com:8080/path").toS3ContentVersionKey({
				minuteId: "2026-03-26T14:32Z",
			}),
		).toBe("content-versions/example.com%3A8080%2Fpath/2026-03-26T14-32Z/content.html");
	});

	it("matches between write and read sides for the same URL regardless of scheme", () => {
		const write = ArticleResourceUniqueId.parse("https://example.com/article").toS3ContentVersionKey({
			minuteId: "2026-07-10T09:41Z",
		});
		const read = ArticleResourceUniqueId.parse("http://example.com/article").toS3ContentVersionKey({
			minuteId: "2026-07-10T09:41Z",
		});
		expect(write).toBe(read);
	});
});

describe("ArticleResourceUniqueId key-family prefixes", () => {
	it("toS3ImagePrefix covers every key toS3ImageKey can produce", () => {
		const id = ArticleResourceUniqueId.parse("https://example.com/blog/post");
		expect(id.toS3ImagePrefix()).toBe("content/example.com%2Fblog%2Fpost/images/");
		expect(id.toS3ImageKey("abc123.png").startsWith(id.toS3ImagePrefix())).toBe(true);
	});

	it("toS3SourcesPrefix covers the tier source and its metadata sidecar", () => {
		const id = ArticleResourceUniqueId.parse("https://example.com/blog/post");
		expect(id.toS3SourcesPrefix()).toBe("articles/example.com%2Fblog%2Fpost/sources/");
		expect(id.toS3SourceKey({ tier: "tier-0" }).startsWith(id.toS3SourcesPrefix())).toBe(true);
		expect(id.toS3SourceMetadataKey({ tier: "tier-1" }).startsWith(id.toS3SourcesPrefix())).toBe(true);
	});

	it("toS3ContentVersionsPrefix covers every dated snapshot", () => {
		const id = ArticleResourceUniqueId.parse("https://example.com/blog/post");
		expect(id.toS3ContentVersionsPrefix()).toBe("content-versions/example.com%2Fblog%2Fpost/");
		expect(
			id.toS3ContentVersionKey({ minuteId: "2026-07-10T09:41Z" }).startsWith(id.toS3ContentVersionsPrefix()),
		).toBe(true);
	});
});

describe("toCrawlVersionMinuteId", () => {
	it("truncates a full-precision instant to minute precision in UTC", () => {
		expect(toCrawlVersionMinuteId("2026-07-10T09:41:32.123Z")).toBe("2026-07-10T09:41Z");
	});

	it("normalises a non-UTC offset to UTC before truncating", () => {
		expect(toCrawlVersionMinuteId("2026-07-10T11:41:00+02:00")).toBe("2026-07-10T09:41Z");
	});

	it("collapses two same-minute instants to one identity", () => {
		expect(toCrawlVersionMinuteId("2026-07-10T09:41:05.000Z")).toBe(
			toCrawlVersionMinuteId("2026-07-10T09:41:59.999Z"),
		);
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

describe("ArticleResourceUniqueId S3 keys for over-long URLs", () => {
	it("keeps every key and prefix inside the 1024-byte S3 limit for a 1574-character presigned URL", () => {
		const id = ArticleResourceUniqueId.parse(
			`https://s3-euw1-ap-pe-df-pch-content-store-p.s3.eu-west-1.amazonaws.com/9781003679479/preview.pdf?AWSAccessKeyId=EXAMPLEACCESSKEYID00&Expires=1785058010&x-amz-security-token=${"I".repeat(1400)}`,
		);
		const keys = [
			id.toS3ContentKey(),
			id.toS3ImageKey("0123456789abcdef.webp"),
			id.toS3PendingHtmlKey(),
			id.toS3PendingPdfKey(),
			id.toS3RefreshHtmlKey(),
			id.toS3SourceKey({ tier: "tier-0" }),
			id.toS3ContentVersionKey({ minuteId: "2026-07-10T09:41Z" }),
			id.toS3ImagePrefix(),
			id.toS3SourcesPrefix(),
			id.toS3ContentVersionsPrefix(),
			id.toS3SourceMetadataKey({ tier: "tier-0" }),
		];

		expect(keys.filter((key) => Buffer.byteLength(key) > 1024)).toEqual([]);
	});

	it("keeps the percent-encoded segment when the encoded id is exactly 900 characters", () => {
		const id = ArticleResourceUniqueId.parse(`https://example.com/${"a".repeat(886)}`);

		expect(encodeURIComponent(id.value)).toHaveLength(900);
		expect(id.toS3ContentKey()).toBe(`content/example.com%2F${"a".repeat(886)}/content.html`);
	});

	it("switches to a sha256 segment when the encoded id reaches 901 characters", () => {
		const id = ArticleResourceUniqueId.parse(`https://example.com/${"a".repeat(887)}`);

		expect(encodeURIComponent(id.value)).toHaveLength(901);
		expect(id.toS3ContentKey()).toBe(
			"content/sha256-d10aa228a89818b4a1b03366cb0fa25a018ebb9a564c3f44a57f7302ed741b6c/content.html",
		);
	});

	it("derives one hashed key from the http and https forms of the same over-long URL", () => {
		const path = "a".repeat(887);

		expect(ArticleResourceUniqueId.parse(`https://example.com/${path}`).toS3ContentKey())
			.toBe(ArticleResourceUniqueId.parse(`http://example.com/${path}`).toS3ContentKey());
	});

	it("keeps each prefix a string-prefix of its keys once the segment is hashed", () => {
		const id = ArticleResourceUniqueId.parse(`https://example.com/${"a".repeat(887)}`);

		expect(id.toS3ImageKey("abc123.png").startsWith(id.toS3ImagePrefix())).toBe(true);
		expect(id.toS3SourceKey({ tier: "tier-0" }).startsWith(id.toS3SourcesPrefix())).toBe(true);
		expect(id.toS3SourceMetadataKey({ tier: "tier-1" }).startsWith(id.toS3SourcesPrefix())).toBe(true);
		expect(
			id.toS3ContentVersionKey({ minuteId: "2026-07-10T09:41Z" }).startsWith(id.toS3ContentVersionsPrefix()),
		).toBe(true);
	});

	it("URL path decodes once to match the S3 image key once the segment is hashed", () => {
		const id = ArticleResourceUniqueId.parse(`https://example.com/${"a".repeat(887)}`);
		const url = id.toImageCdnUrl({ baseUrl: "https://cdn.example", filename: "hash.png" });
		const urlPath = new URL(url).pathname;

		expect(decodeURIComponent(urlPath.replace(/^\//, ""))).toBe(id.toS3ImageKey("hash.png"));
	});
});
