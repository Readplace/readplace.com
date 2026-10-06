import { calculateReadTime } from "@packages/domain/article";
import type { MarkCrawlPending } from "@packages/provider-contracts/article-crawl";
import type { PinContentSource, SaveArticleGlobally } from "@packages/provider-contracts/article-store";
import type { MarkSummaryPending } from "@packages/provider-contracts/article-summary";
import type { PublishSaveAnonymousLink } from "@packages/provider-contracts/events";
import type { SaveIdentity } from "./resolve-save-identity";

export type StartAnonymousCrawl = (identity: SaveIdentity) => Promise<void>;

export interface StartAnonymousCrawlDependencies {
	saveArticleGlobally: SaveArticleGlobally;
	pinContentSource: PinContentSource;
	markCrawlPending: MarkCrawlPending;
	markSummaryPending: MarkSummaryPending;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	now: () => Date;
}

export function initStartAnonymousCrawl(deps: StartAnonymousCrawlDependencies): StartAnonymousCrawl {
	return async ({ url, contentSourceUrl }) => {
		const host = new URL(url).hostname;
		await deps.saveArticleGlobally({
			url,
			metadata: { title: host, siteName: host, excerpt: "", wordCount: 0 },
			estimatedReadTime: calculateReadTime(0),
			savedAt: deps.now(),
		});
		if (contentSourceUrl !== undefined) {
			await deps.pinContentSource({ articleUrl: url, contentSourceUrl });
		}
		await deps.markCrawlPending({ url });
		await deps.markSummaryPending({ url });
		await deps.publishSaveAnonymousLink({ url });
		if (contentSourceUrl !== undefined) {
			await deps.publishSaveAnonymousLink({ url, captureUrl: contentSourceUrl });
		}
	};
}
