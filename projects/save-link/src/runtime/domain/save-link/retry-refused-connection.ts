import type { CrawlAndFinalizeArticle, CrawlAndFinalizeResult } from "@packages/finalize-article";
import type { Logger } from "@packages/logger";

export const REFUSED_CONNECTION_RETRY_DELAY_MS = 5_000;

function isRefusedConnection(result: CrawlAndFinalizeResult): boolean {
	return result.status === "failed" && result.failure?.kind === "origin-unreachable" && result.failure.code === "ECONNREFUSED";
}

export function withRefusedConnectionRetry(deps: {
	crawlAndFinalizeArticle: CrawlAndFinalizeArticle;
	delay: (milliseconds: number) => Promise<unknown>;
	logger: Logger;
}): CrawlAndFinalizeArticle {
	return async (params) => {
		const result = await deps.crawlAndFinalizeArticle(params);
		if (!isRefusedConnection(result)) return result;
		deps.logger.warn("[ArchiveCapture] connection refused, retrying once", { url: params.url, fetchUrl: params.fetchUrl });
		await deps.delay(REFUSED_CONNECTION_RETRY_DELAY_MS);
		return deps.crawlAndFinalizeArticle(params);
	};
}
