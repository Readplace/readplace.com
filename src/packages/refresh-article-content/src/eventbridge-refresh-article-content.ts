import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { RefreshArticleContentCommand } from "@packages/hutch-infra-components";
import type { PublishRefreshArticleContent } from "@packages/test-fixtures/providers/events";
import type { PutRefreshHtml } from "@packages/test-fixtures/providers/refresh-html";

export function initEventBridgeRefreshArticleContent(deps: {
	publishEvent: PublishEvent;
	putRefreshHtml: PutRefreshHtml;
}): { publishRefreshArticleContent: PublishRefreshArticleContent } {
	const { publishEvent, putRefreshHtml } = deps;

	const publishRefreshArticleContent: PublishRefreshArticleContent = async (params) => {
		await putRefreshHtml({ url: params.url, html: params.html });
		await publishEvent(RefreshArticleContentCommand, {
			url: params.url,
			metadata: params.metadata,
			estimatedReadTime: params.estimatedReadTime,
			etag: params.etag,
			lastModified: params.lastModified,
			contentFetchedAt: params.contentFetchedAt,
		});
	};

	return { publishRefreshArticleContent };
}
