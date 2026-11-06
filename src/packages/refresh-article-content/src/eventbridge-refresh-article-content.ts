import type { PublishEvent } from "@packages/infra-components/runtime";
import { RefreshArticleContentCommand } from "@packages/infra-components";
import type { PublishRefreshArticleContent } from "@packages/provider-contracts/events";
import type { PutRefreshHtml } from "@packages/provider-contracts/refresh-html";

export function initEventBridgeRefreshArticleContent(deps: {
	publishEvent: PublishEvent;
	putRefreshHtml: PutRefreshHtml;
}): { publishRefreshArticleContent: PublishRefreshArticleContent } {
	const { publishEvent, putRefreshHtml } = deps;

	const publishRefreshArticleContent: PublishRefreshArticleContent = async (params) => {
		await putRefreshHtml({ url: params.url, html: params.html, evaluationHtml: params.evaluationHtml, saveAttemptId: params.saveAttemptId });
		await publishEvent(RefreshArticleContentCommand, {
			url: params.url,
			sourceUrl: params.sourceUrl,
			sourceOriginalUrl: params.sourceOriginalUrl,
			saveAttemptId: params.saveAttemptId,
			metadata: params.metadata,
			estimatedReadTime: params.estimatedReadTime,
			etag: params.etag,
			lastModified: params.lastModified,
			contentFetchedAt: params.contentFetchedAt,
			bodyHash: params.bodyHash,
		});
	};

	return { publishRefreshArticleContent };
}
