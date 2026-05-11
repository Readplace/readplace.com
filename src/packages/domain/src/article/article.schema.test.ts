import {
	SaveArticleInputSchema,
	SaveHtmlInputSchema,
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
