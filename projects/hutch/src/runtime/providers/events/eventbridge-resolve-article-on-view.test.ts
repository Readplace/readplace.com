import { newSaveAttemptId } from "@packages/domain/article";
import { ResolveArticleOnViewCommand } from "@packages/hutch-infra-components";
import { initEventBridgeResolveArticleOnView } from "./eventbridge-resolve-article-on-view";

describe("initEventBridgeResolveArticleOnView", () => {
	it("publishes the request as a ResolveArticleOnViewCommand the resolution worker accepts", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const { publishResolveArticleOnView } = initEventBridgeResolveArticleOnView({ publishEvent });
		const params = {
			url: "https://example.com/post",
			saveAttemptId: newSaveAttemptId(),
			axes: "summary" as const,
			surface: "readlist-html" as const,
		};

		await publishResolveArticleOnView(params);

		expect(publishEvent).toHaveBeenCalledWith(ResolveArticleOnViewCommand, params);
		expect(ResolveArticleOnViewCommand.detailSchema.safeParse(params).success).toBe(true);
	});
});
