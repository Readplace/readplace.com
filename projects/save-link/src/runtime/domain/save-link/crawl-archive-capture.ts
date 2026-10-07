import assert from "node:assert";
import type { CandidateId, SaveAttemptId } from "@packages/domain/article";
import { ARCHIVE_TIER } from "@packages/article-state-types";
import type { CrawlAndFinalizeArticle, CrawlAndFinalizeResult } from "@packages/finalize-article";
import { ArchiveCaptureCrawlFailedEvent, type LogCrawlOutcome } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import type { VerifyWrapperSource } from "@packages/save-article";
import { candidateProvenance } from "../select-content/candidate-provenance";

export type CrawlArchiveCapture = (params: { url: string; captureUrl: string; saveAttemptId: SaveAttemptId; sourceOriginalUrl?: string }) => Promise<{ id: CandidateId; tier: "tier-2" } | undefined>;

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
	verifyWrapperSource: VerifyWrapperSource;
	now: () => Date;
}): CrawlArchiveCapture {
	return async ({ url, captureUrl, saveAttemptId, sourceOriginalUrl }) => {
		const verified = await deps.verifyWrapperSource({ articleUrl: url, sourceUrl: captureUrl, claimedOriginalUrl: sourceOriginalUrl });
		if (verified === undefined) {
			await deps.publishEvent(ArchiveCaptureCrawlFailedEvent, { url, captureUrl, reason: "unverified source identity" });
			return undefined;
		}
		const fetchedAt = deps.now().toISOString();
		const result = await deps.crawlAndFinalizeArticle({ writeContext: { url, attemptId: saveAttemptId }, url: verified.originalUrl, fetchUrl: verified.sourceUrl, retainResponseBody: true });
		const snapshot = await deps.readTierSnapshot({ url });
		const outcome = { url, thisTier: ARCHIVE_TIER, otherTierStatus: snapshot.tier1Status, pickedTier: snapshot.pickedTier };
		if (result.status !== "fetched") {
			const reason = failureReasonOf(result);
			deps.logCrawlOutcome({ ...outcome, thisTierStatus: "failed" });
			await deps.publishEvent(ArchiveCaptureCrawlFailedEvent, { url, captureUrl, reason });
			deps.logger.warn("[ArchiveCapture] capture not crawled", { url, captureUrl, reason });
			return undefined;
		}
		const evaluationHtml = result.evaluationHtml;
		assert(evaluationHtml !== undefined, "archive capture crawl must retain the response body");
		const metadata = candidateProvenance({
			metadata: result.article.metadata,
			html: result.article.html,
			evaluationHtml,
			attemptId: saveAttemptId,
			originalUrl: verified.originalUrl,
			sourceUrl: verified.sourceUrl,
			kind: "wrapper",
			fetchedAt,
			httpStatus: result.httpStatus,
		});
		await deps.putTierSource({
			url,
			tier: ARCHIVE_TIER,
			html: result.article.html,
			evaluationHtml,
			metadata,
		});
		deps.logCrawlOutcome({ ...outcome, thisTierStatus: "success" });
		return { id: metadata.id, tier: "tier-2" };
	};
}
