import {
	SaveArticleInputSchema,
	BulkSaveManifestSchema,
	SaveHtmlInputSchema,
	LAMBDA_SYNC_INVOKE_PAYLOAD_BYTES,
	MAX_UPLOAD_REQUEST_BYTES,
	MAX_UPLOAD_CONTENT_BYTES,
	MAX_BULK_PAGE_CONTENT_BYTES,
	ArticleStatusSchema,
	MinutesSchema,
} from "./article.schema";

describe("SaveArticleInputSchema", () => {
	it("accepts a valid URL", () => {
		const result = SaveArticleInputSchema.safeParse({ url: "https://example.com/article" });

		expect(result.success).toBe(true);
	});

	it("rejects a missing url field", () => {
		const result = SaveArticleInputSchema.safeParse({});

		expect(result.success).toBe(false);
	});

	it("rejects an invalid URL string", () => {
		const result = SaveArticleInputSchema.safeParse({ url: "not-a-url" });

		expect(result.success).toBe(false);
	});
});

describe("BulkSaveManifestSchema", () => {
	it("accepts an array of url-only page entries", () => {
		const result = BulkSaveManifestSchema.safeParse([
			{ url: "https://example.com/a" },
			{ url: "https://example.com/b" },
		]);

		expect(result.success).toBe(true);
	});

	it("accepts entries carrying an optional title and mediaType", () => {
		const result = BulkSaveManifestSchema.safeParse([
			{ url: "https://example.com/a", title: "A", mediaType: "text/html" },
		]);

		expect(result.success).toBe(true);
	});

	it("rejects an empty array", () => {
		const result = BulkSaveManifestSchema.safeParse([]);

		expect(result.success).toBe(false);
	});

	it("rejects an entry without a url", () => {
		const result = BulkSaveManifestSchema.safeParse([{ title: "no url" }]);

		expect(result.success).toBe(false);
	});
});

describe("SaveHtmlInputSchema", () => {
	it("accepts a valid url + non-empty rawHtml", () => {
		const result = SaveHtmlInputSchema.safeParse({
			url: "https://example.com/article",
			rawHtml: "<html><body>x</body></html>",
		});

		expect(result.success).toBe(true);
	});

	it("accepts an optional title", () => {
		const result = SaveHtmlInputSchema.safeParse({
			url: "https://example.com/article",
			rawHtml: "<html />",
			title: "My title",
		});

		expect(result.success).toBe(true);
	});

	it("rejects empty rawHtml", () => {
		const result = SaveHtmlInputSchema.safeParse({
			url: "https://example.com/article",
			rawHtml: "",
		});

		expect(result.success).toBe(false);
	});
});

describe("upload limits", () => {
	const BASE64_INFLATION = 4 / 3;

	it("keeps a full request body within the Lambda sync-invoke payload quota once base64-inflated", () => {
		expect(MAX_UPLOAD_REQUEST_BYTES * BASE64_INFLATION).toBeLessThanOrEqual(
			LAMBDA_SYNC_INVOKE_PAYLOAD_BYTES,
		);
	});

	it("leaves the multipart envelope room under the request limit", () => {
		expect(MAX_UPLOAD_CONTENT_BYTES).toBeLessThan(MAX_UPLOAD_REQUEST_BYTES);
	});

	it("leaves a bulk page's advertised budget manifest headroom under the request limit", () => {
		expect(MAX_BULK_PAGE_CONTENT_BYTES).toBeLessThan(MAX_UPLOAD_REQUEST_BYTES);
	});

	it("advertises a bulk page budget above the single-save direct budget, restoring the 3-4.4 MiB band", () => {
		expect(MAX_BULK_PAGE_CONTENT_BYTES).toBeGreaterThan(MAX_UPLOAD_CONTENT_BYTES);
	});
});

describe("ArticleStatusSchema", () => {
	it("accepts 'unread'", () => {
		expect(ArticleStatusSchema.parse("unread")).toBe("unread");
	});

	it("accepts 'read'", () => {
		expect(ArticleStatusSchema.parse("read")).toBe("read");
	});

	it("rejects unknown values", () => {
		expect(ArticleStatusSchema.safeParse("archived").success).toBe(false);
	});
});

describe("MinutesSchema", () => {
	it("transforms a number into a Minutes brand", () => {
		expect(MinutesSchema.parse(7)).toBe(7);
	});

	it("rejects non-numbers", () => {
		expect(MinutesSchema.safeParse("seven").success).toBe(false);
	});
});
