import { newSaveAttemptId, calculateReadTime, isArchiveHost } from "@packages/domain/article";
import type { MarkCrawlPending } from "@packages/provider-contracts/article-crawl";
import type { ResolvedSaveIdentity } from "@packages/provider-contracts/article-freshness";
import type { PinContentSource, SaveArticleGlobally } from "@packages/provider-contracts/article-store";
import type { MarkSummaryPending } from "@packages/provider-contracts/article-summary";
import type { PublishSaveAnonymousLink } from "@packages/provider-contracts/events";

export type StartAnonymousCrawl = (identity: ResolvedSaveIdentity) => Promise<void>;

export interface StartAnonymousCrawlDependencies {
	saveArticleGlobally: SaveArticleGlobally;
	pinContentSource: PinContentSource;
	markCrawlPending: MarkCrawlPending;
	markSummaryPending: MarkSummaryPending;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	now: () => Date;
}

export function initStartAnonymousCrawl(deps: StartAnonymousCrawlDependencies): StartAnonymousCrawl {
	return async (identity) => {
		const { url } = identity;
		const host = new URL(url).hostname;
		await deps.saveArticleGlobally({
			url,
			metadata: { title: host, siteName: host, excerpt: "", wordCount: 0 },
			estimatedReadTime: calculateReadTime(0),
			savedAt: deps.now(),
		});
		await deps.markCrawlPending({ url });
		await deps.markSummaryPending({ url });
		if (identity.contentSourceUrl !== undefined && isArchiveHost(identity.contentSourceUrl)) {
			await deps.pinContentSource({ articleUrl: url, contentSourceUrl: identity.contentSourceUrl, sourceOriginalUrl: identity.sourceOriginalUrl });
		}
		await deps.publishSaveAnonymousLink({
			url,
			captureUrl: identity.contentSourceUrl,
			sourceOriginalUrl: identity.sourceOriginalUrl,
			saveAttemptId: newSaveAttemptId(),
		});
	};
}
