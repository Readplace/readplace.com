import type { RefreshArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type { FindArticleCrawlStatus } from "@packages/provider-contracts/article-crawl";
import type { FindArticleByUrl } from "@packages/provider-contracts/article-store";
import type { PublishStaleCheckRequested } from "@packages/provider-contracts/events";

export function initSubmitFreshness(deps: {
	findArticleByUrl: FindArticleByUrl;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	resolveCanonicalIdentity: (url: string) => Promise<string>;
	publishStaleCheckRequested: PublishStaleCheckRequested;
}): { refreshArticleIfStale: RefreshArticleIfStale } {
	const {
		findArticleByUrl,
		findArticleCrawlStatus,
		resolveCanonicalIdentity,
		publishStaleCheckRequested,
	} = deps;

	const refreshArticleIfStale: RefreshArticleIfStale = async ({ url }) => {
		const resolved = await resolveCanonicalIdentity(url);
		const existing = await findArticleByUrl(resolved);
		if (!existing || existing.purgedAt) {
			return { action: "new" };
		}
		const crawl = await findArticleCrawlStatus(resolved);
		if (!crawl || crawl.status === "pending") {
			return { action: "new" };
		}
		await publishStaleCheckRequested({ url: resolved });
		return { action: "skip" };
	};

	return { refreshArticleIfStale };
}
