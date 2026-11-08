import type { PutTierSource } from "@packages/tier-source";
import assert from "node:assert";
import { canonicalIdentityOf } from "@packages/article-resource-unique-id";
import { initCommitTierCandidate } from "../crawl-leg/commit-tier-candidate";
import type { Logger } from "@packages/logger";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { ReadRefreshHtml } from "@packages/provider-contracts/refresh-html";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { RefreshArticleContentSkippedEvent, type RefreshArticleContentSkipReason } from "@packages/infra-components";
import { decideRefreshSkip, type FindRefreshAdmissionRow } from "./decide-refresh-skip";
import { RefreshArticleContentCommand, type RefreshArticleContentDetail } from "./index";

/**
 * Refresh now goes through the same shape as the initial save → recrawl:
 *
 *   1. Read the freshly-fetched HTML from S3 (staged under refresh-html/ by
 *      the publisher) — keeps EventBridge detail payloads well under the
 *      256 KB cap regardless of article size.
 *   2. Write that HTML as a tier-1 source.
 *   3. Publish RefreshContentExtractedEvent.
 *   4. refresh-content-extracted-handler runs the selector over all
 *      available tier sources (tier-0 from the extension if present, plus
 *      the just-written tier-1), picks the winner, and calls refreshContent.
 *
 * The selector step lets the row keep a tier-0 win instead of silently
 * flipping to tier-1 just because refresh always fetches server-side.
 */
export function initRefreshArticleContentHandler(deps: {
	findRefreshAdmissionRow: FindRefreshAdmissionRow;
	readRefreshHtml: ReadRefreshHtml;
	resolveOriginalUrl: (url: string) => Promise<string>;
	putTierSource: PutTierSource;
	publishEvent: PublishEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { readRefreshHtml, logger } = deps;
	const commitTierCandidate = initCommitTierCandidate(deps);

	async function skip(detail: RefreshArticleContentDetail, reason: RefreshArticleContentSkipReason): Promise<void> {
		await deps.publishEvent(RefreshArticleContentSkippedEvent, {
			url: detail.url,
			saveAttemptId: detail.saveAttemptId,
			contentFetchedAt: detail.contentFetchedAt,
			reason,
		});
		logger.info("[RefreshArticleContent] skipped", { url: detail.url, reason, contentFetchedAt: detail.contentFetchedAt });
	}

	return initSqsRecordHandler({
		definition: RefreshArticleContentCommand,
		logger,
		failure: { message: "[RefreshArticleContent] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			logger.info("[RefreshArticleContent] processing", { url: detail.url });

			const refusal = decideRefreshSkip({ row: await deps.findRefreshAdmissionRow(detail.url), messageFetchedAt: detail.contentFetchedAt });
			if (refusal !== undefined) return skip(detail, refusal);

			const { saveAttemptId } = detail;
			const originalUrl = await deps.resolveOriginalUrl(detail.url);
			assert(canonicalIdentityOf(detail.sourceOriginalUrl) === canonicalIdentityOf(originalUrl), "Refresh source original no longer matches article identity");
			const [html, evaluationHtml] = await Promise.all([
				readRefreshHtml(detail.url, { saveAttemptId }),
				readRefreshHtml(detail.url, { saveAttemptId, representation: "evaluation" }),
			]);
			if (html === undefined || evaluationHtml === undefined) return skip(detail, "staged-html-expired");
			await commitTierCandidate({
				url: detail.url,
				attemptId: saveAttemptId,
				originalUrl,
				sourceUrl: detail.sourceUrl,
				fetchedAt: detail.contentFetchedAt,
				leg: { tier: "tier-1", kind: "live" },
				metadata: { ...detail.metadata, estimatedReadTime: detail.estimatedReadTime },
				html,
				evaluation: { hashed: evaluationHtml, stored: evaluationHtml },
				crawlOutcome: { report: "none" },
				announce: {
					event: "refresh-content-extracted",
					etag: detail.etag,
					lastModified: detail.lastModified,
					contentFetchedAt: detail.contentFetchedAt,
					bodyHash: detail.bodyHash,
				},
			});

			logger.info("[RefreshArticleContent] tier-1 source written + event published", {
				url: detail.url,
			});
		},
	});
}
