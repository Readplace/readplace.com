import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ReaderArticleHashId } from "./reader-article-hash-id";

describe("ReaderArticleHashId.from", () => {
	it("produces a 32-char hex value", () => {
		const id = ReaderArticleHashId.from("https://example.com/article");
		expect(id.value).toMatch(/^[0-9a-f]{32}$/);
	});

	it("produces the same ID for the same URL", () => {
		const id1 = ReaderArticleHashId.from("https://example.com/article");
		const id2 = ReaderArticleHashId.from("https://example.com/article");
		expect(id1.value).toBe(id2.value);
	});

	it("produces the same ID regardless of scheme", () => {
		const https = ReaderArticleHashId.from("https://example.com/article");
		const http = ReaderArticleHashId.from("http://example.com/article");
		expect(https.value).toBe(http.value);
	});

	it("produces the same ID regardless of fragment", () => {
		const withFragment = ReaderArticleHashId.from("https://example.com/article#heading");
		const withoutFragment = ReaderArticleHashId.from("https://example.com/article");
		expect(withFragment.value).toBe(withoutFragment.value);
	});

	it("produces different IDs for different URLs", () => {
		const id1 = ReaderArticleHashId.from("https://example.com/article-1");
		const id2 = ReaderArticleHashId.from("https://example.com/article-2");
		expect(id1.value).not.toBe(id2.value);
	});

	it("produces different IDs for different query params", () => {
		const id1 = ReaderArticleHashId.from("https://example.com/path?page=1");
		const id2 = ReaderArticleHashId.from("https://example.com/path?page=2");
		expect(id1.value).not.toBe(id2.value);
	});
});

describe("ReaderArticleHashId.fromResourceUniqueId", () => {
	it("derives the same id .from() derives for the same URL", () => {
		const viaUrl = ReaderArticleHashId.from("https://example.com/article?utm_source=x");
		const viaResourceId = ReaderArticleHashId.fromResourceUniqueId(
			ArticleResourceUniqueId.parse("https://example.com/article?utm_source=x").value,
		);
		expect(viaResourceId.value).toBe(viaUrl.value);
	});

	it("produces a 32-char hex value", () => {
		expect(
			ReaderArticleHashId.fromResourceUniqueId("example.com/article").value,
		).toMatch(/^[0-9a-f]{32}$/);
	});
});

describe("ReaderArticleHashId.fromHash", () => {
	it("accepts a valid 32-char lowercase hex string", () => {
		const hash = "a".repeat(32);
		expect(ReaderArticleHashId.fromHash(hash).value).toBe(hash);
	});

	it("round-trips with .from()", () => {
		const derived = ReaderArticleHashId.from("https://example.com/article");
		const reparsed = ReaderArticleHashId.fromHash(derived.value);
		expect(reparsed.value).toBe(derived.value);
	});

	it("rejects strings shorter than 32 chars", () => {
		expect(() => ReaderArticleHashId.fromHash("a".repeat(31))).toThrow();
	});

	it("rejects strings longer than 32 chars", () => {
		expect(() => ReaderArticleHashId.fromHash("a".repeat(33))).toThrow();
	});

	it("rejects non-hex characters", () => {
		expect(() => ReaderArticleHashId.fromHash("g".repeat(32))).toThrow();
	});

	it("rejects uppercase hex", () => {
		expect(() => ReaderArticleHashId.fromHash("A".repeat(32))).toThrow();
	});
});

describe("ReaderArticleHashId serialization", () => {
	it("toJSON returns the hash string", () => {
		const id = ReaderArticleHashId.from("https://example.com/article");
		expect(id.toJSON()).toBe(id.value);
	});

	it("toString returns the hash string", () => {
		const id = ReaderArticleHashId.from("https://example.com/article");
		expect(id.toString()).toBe(id.value);
	});

	it("serializes as a plain string via JSON.stringify", () => {
		const id = ReaderArticleHashId.from("https://example.com/article");
		expect(JSON.stringify(id)).toBe(`"${id.value}"`);
	});

	it("interpolates as the hash in template literals", () => {
		const id = ReaderArticleHashId.from("https://example.com/article");
		expect(`${id}`).toBe(id.value);
	});
});
