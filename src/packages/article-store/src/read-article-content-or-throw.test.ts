import type { ContentProvider } from "@packages/provider-contracts/article-store";
import { initReadArticleContentOrThrow } from "./read-article-content-or-throw";

describe("initReadArticleContentOrThrow", () => {
	it("returns content from the first provider that has it", async () => {
		const s3: ContentProvider = async () => undefined;
		const dynamodb: ContentProvider = async () => "dynamodb content";

		const readArticleContent = initReadArticleContentOrThrow({ storageProviderQueryOrder: [s3, dynamodb] });

		expect(await readArticleContent("https://example.com/article")).toBe("dynamodb content");
	});

	it("returns undefined when no provider has content", async () => {
		const empty: ContentProvider = async () => "";

		const readArticleContent = initReadArticleContentOrThrow({ storageProviderQueryOrder: [empty] });

		expect(await readArticleContent("https://example.com/article")).toBeUndefined();
	});

	it("rejects with a provider's failure instead of reporting the article as having no content", async () => {
		const s3: ContentProvider = async () => {
			throw new Error("SlowDown");
		};
		const dynamodb: ContentProvider = async () => "dynamodb content";

		const readArticleContent = initReadArticleContentOrThrow({ storageProviderQueryOrder: [s3, dynamodb] });

		await expect(readArticleContent("https://example.com/article")).rejects.toThrow("SlowDown");
	});
});
