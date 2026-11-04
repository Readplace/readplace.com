import { newSaveAttemptId } from "@packages/domain/article";
import { noopLogger } from "@packages/hutch-logger";
import { initInMemoryResolveArticleOnView } from "./in-memory-resolve-article-on-view";

describe("initInMemoryResolveArticleOnView", () => {
	it("records each published command", async () => {
		const { publishResolveArticleOnView, publishedResolveArticleOnView } = initInMemoryResolveArticleOnView({
			logger: noopLogger,
		});
		const command = {
			url: "https://example.com/post",
			saveAttemptId: newSaveAttemptId(),
			axes: "crawl-and-summary" as const,
			surface: "reader" as const,
		};

		await publishResolveArticleOnView(command);

		expect(publishedResolveArticleOnView).toEqual([command]);
	});
});
