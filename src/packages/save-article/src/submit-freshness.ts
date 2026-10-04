import type { RefreshArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type { FindArticleCrawlStatus } from "@packages/provider-contracts/article-crawl";
import type { FindArticleByUrl } from "@packages/provider-contracts/article-store";
import type { PublishStaleCheckRequested } from "@packages/provider-contracts/events";
import type { ResolveSaveIdentity } from "./resolve-save-identity";

export interface SubmitFreshnessDependencies {
	findArticleByUrl: FindArticleByUrl;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	resolveSaveIdentity: ResolveSaveIdentity;
	publishStaleCheckRequested: PublishStaleCheckRequested;
}

export function initSubmitFreshness(deps: SubmitFreshnessDependencies): {
	refreshArticleIfStale: RefreshArticleIfStale;
} {
	const {
		findArticleByUrl,
		findArticleCrawlStatus,
		resolveSaveIdentity,
		publishStaleCheckRequested,
	} = deps;

	const refreshArticleIfStale: RefreshArticleIfStale = async ({ url }) => {
		const identity = await resolveSaveIdentity(url);
		const { url: resolved, contentSourceUrl } = identity;
		const existing = await findArticleByUrl(resolved);
		if (!existing || existing.purgedAt) {
			return { action: "new", identity };
		}
		const crawl = await findArticleCrawlStatus(resolved);
		if (!crawl || crawl.status === "pending") {
			return { action: "new", identity };
		}
		if (contentSourceUrl !== undefined && crawl.status !== "ready") {
			return { action: "new", identity };
		}
		await publishStaleCheckRequested({ url: resolved });
		return { action: "skip", identity };
	};

	return { refreshArticleIfStale };
}
