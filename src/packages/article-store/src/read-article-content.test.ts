import { initReadArticleContent } from "./read-article-content";
import type { ContentProvider } from "./read-article-content";

describe("initReadArticleContent", () => {
	it("returns content from the first provider that succeeds", async () => {
		const s3: ContentProvider = async () => "s3 content";
		const dynamodb: ContentProvider = async () => "dynamodb content";

		const readArticleContent = initReadArticleContent({
			storageProviderQueryOrder: [s3, dynamodb],
			logError: () => {},
		});

		const content = await readArticleContent("https://example.com/article");
		expect(content).toEqual({ kind: "article", body: "s3 content" });
	});

	it("falls back to second provider when first throws", async () => {
		const s3: ContentProvider = async () => {
			throw new Error("NoSuchKey");
		};
		const dynamodb: ContentProvider = async () => "dynamodb content";
		const errors: string[] = [];

		const readArticleContent = initReadArticleContent({
			storageProviderQueryOrder: [s3, dynamodb],
			logError: (msg) => errors.push(msg),
		});

		const content = await readArticleContent("https://example.com/article");
		expect(content).toEqual({ kind: "article", body: "dynamodb content" });
		expect(errors).toHaveLength(1);
	});

	it("falls back to second provider when first returns undefined", async () => {
		const s3: ContentProvider = async () => undefined;
		const dynamodb: ContentProvider = async () => "dynamodb content";

		const readArticleContent = initReadArticleContent({
			storageProviderQueryOrder: [s3, dynamodb],
			logError: () => {},
		});

		const content = await readArticleContent("https://example.com/article");
		expect(content).toEqual({ kind: "article", body: "dynamodb content" });
	});

	it("falls back to second provider when first returns empty string", async () => {
		const s3: ContentProvider = async () => "";
		const dynamodb: ContentProvider = async () => "dynamodb content";

		const readArticleContent = initReadArticleContent({
			storageProviderQueryOrder: [s3, dynamodb],
			logError: () => {},
		});

		const content = await readArticleContent("https://example.com/article");
		expect(content).toEqual({ kind: "article", body: "dynamodb content" });
	});

	it("reports a missing body when all providers fail", async () => {
		const s3: ContentProvider = async () => {
			throw new Error("NoSuchKey");
		};
		const dynamodb: ContentProvider = async () => undefined;

		const readArticleContent = initReadArticleContent({
			storageProviderQueryOrder: [s3, dynamodb],
			logError: () => {},
		});

		const content = await readArticleContent("https://example.com/article");
		expect(content).toEqual({ kind: "missing" });
	});

	it("passes undefined to logError when a provider throws a non-Error", async () => {
		const s3: ContentProvider = async () => {
			throw "boom";
		};
		const dynamodb: ContentProvider = async () => "dynamodb content";
		let loggedError: unknown = "unset";

		const readArticleContent = initReadArticleContent({
			storageProviderQueryOrder: [s3, dynamodb],
			logError: (_message, error) => {
				loggedError = error;
			},
		});

		const content = await readArticleContent("https://example.com/article");
		expect(content).toEqual({ kind: "article", body: "dynamodb content" });
		expect(loggedError).toBeUndefined();
	});

	it("normalizes the URL before passing to providers", async () => {
		const receivedValues: string[] = [];
		const provider: ContentProvider = async (articleResourceUniqueId) => {
			receivedValues.push(articleResourceUniqueId.value);
			return "content";
		};

		const readArticleContent = initReadArticleContent({
			storageProviderQueryOrder: [provider],
			logError: () => {},
		});

		await readArticleContent("https://example.com/article#heading");
		expect(receivedValues[0]).toBe("example.com/article");
	});

	it("reports a webmail page as not an article even when a provider holds its body", async () => {
		const s3: ContentProvider = async () => "<p>Inbox</p>";

		const readArticleContent = initReadArticleContent({
			storageProviderQueryOrder: [s3],
			logError: () => {},
		});

		const content = await readArticleContent("https://mail.google.com/mail/u/2/");
		expect(content).toEqual({ kind: "not-an-article" });
	});
});
