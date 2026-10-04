import { ARCHIVE_TIER } from "@packages/article-state-types";
import type { CrawlAndFinalizeArticle, CrawlAndFinalizeResult } from "@packages/finalize-article";
import { ArchiveCaptureCrawlFailedEvent, type LogCrawlOutcome } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";

export type CrawlArchiveCapture = (params: { url: string; captureUrl: string }) => Promise<"written" | "not-written">;

function failureReasonOf(result: Exclude<CrawlAndFinalizeResult, { status: "fetched" }>): string {
	return result.status === "failed" || result.status === "unsupported"
		? `${result.status}: ${result.reason}`
		: result.status;
}

export function initCrawlArchiveCapture(deps: {
	crawlAndFinalizeArticle: CrawlAndFinalizeArticle;
	putTierSource: PutTierSource;
	readTierSnapshot: ReadTierSnapshot;
	logCrawlOutcome: LogCrawlOutcome;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): CrawlArchiveCapture {
	return async ({ url, captureUrl }) => {
		const result = await deps.crawlAndFinalizeArticle({ url, fetchUrl: captureUrl });
		const snapshot = await deps.readTierSnapshot({ url });
		const outcome = { url, thisTier: ARCHIVE_TIER, otherTierStatus: snapshot.tier1Status, pickedTier: snapshot.pickedTier };
		if (result.status !== "fetched") {
			const reason = failureReasonOf(result);
			deps.logCrawlOutcome({ ...outcome, thisTierStatus: "failed" });
			await deps.publishEvent(ArchiveCaptureCrawlFailedEvent, { url, captureUrl, reason });
			deps.logger.warn("[ArchiveCapture] capture not crawled", { url, captureUrl, reason });
			return "not-written";
		}
		await deps.putTierSource({
			url,
			tier: ARCHIVE_TIER,
			html: result.article.html,
			metadata: { ...result.article.metadata, sourceUrl: captureUrl },
		});
		deps.logCrawlOutcome({ ...outcome, thisTierStatus: "success" });
		return "written";
	};
}
