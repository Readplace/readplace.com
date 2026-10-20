import type { ContentProvider } from "@packages/provider-contracts/article-store";
import { initReadArticleContentOrThrow } from "./read-article-content-or-throw";

describe("initReadArticleContentOrThrow", () => {
	it("returns content from the first provider that has it", async () => {
		const s3: ContentProvider = async () => undefined;
		const dynamodb: ContentProvider = async () => "dynamodb content";

		const readArticleContent = initReadArticleContentOrThrow({ storageProviderQueryOrder: [s3, dynamodb] });

		expect(await readArticleContent("https://example.com/article")).toEqual({ kind: "article", body: "dynamodb content" });
	});

	it("reports a missing body when no provider has content", async () => {
		const empty: ContentProvider = async () => "";

		const readArticleContent = initReadArticleContentOrThrow({ storageProviderQueryOrder: [empty] });

		expect(await readArticleContent("https://example.com/article")).toEqual({ kind: "missing" });
	});

	it("rejects with a provider's failure instead of reporting the article as having no content", async () => {
		const s3: ContentProvider = async () => {
			throw new Error("SlowDown");
		};
		const dynamodb: ContentProvider = async () => "dynamodb content";

		const readArticleContent = initReadArticleContentOrThrow({ storageProviderQueryOrder: [s3, dynamodb] });

		await expect(readArticleContent("https://example.com/article")).rejects.toThrow("SlowDown");
	});

	it("reports a webmail page as not an article even when a provider holds its body", async () => {
		const s3: ContentProvider = async () => "<p>Inbox</p>";

		const readArticleContent = initReadArticleContentOrThrow({ storageProviderQueryOrder: [s3] });

		expect(await readArticleContent("https://mail.google.com/mail/u/2/")).toEqual({ kind: "not-an-article" });
	});
});
