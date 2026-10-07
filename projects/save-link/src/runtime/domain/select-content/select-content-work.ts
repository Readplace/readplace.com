import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import type { SaveAttemptId } from "@packages/domain/article";
import { blockedCauseForStatus, type CrawlFailureReason } from "@packages/article-state-types";
import { isBlockClassStatus } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { VerifyWrapperSource } from "@packages/save-article";
import {
	type LoadArticle,
	type TransitionAndPersist,
	promoteTier,
	recrawlPromoteTier,
	recrawlTieKeptCanonical,
	refreshContent,
} from "@packages/domain/article-aggregate";
import type { ListAvailableTierSources, CandidateReference } from "./list-available-tier-sources";
import type { SelectMostCompleteContent } from "./select-content";
import type { WriteCanonicalContent } from "../../providers/article-store/promote-tier-to-canonical";
import type { RecordCrawlVersion } from "../../providers/article-store/record-crawl-version";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
import { resolveCanonicalImageUrl } from "./resolve-canonical-image-url";
import { type LiveAttempt, type PreparedContentSelection, initLogContentSelection, initPrepareContentSelection } from "./prepare-content-selection";
import { markNoReadableArticle } from "./mark-no-readable-article";
import type { FindArticleContent } from "../../providers/article-store/find-article-content";

export interface SelectContentDependencies {
	listAvailableTierSources: ListAvailableTierSources;
	selectMostCompleteContent: SelectMostCompleteContent;
	writeCanonicalContent: WriteCanonicalContent;
	recordCrawlVersion: RecordCrawlVersion;
	loadArticle: LoadArticle;
	readCanonicalContent: FindArticleContent;
	transitionAndPersist: TransitionAndPersist;
	resolveOriginalUrl: (url: string) => Promise<string>;
	verifyWrapperSource: VerifyWrapperSource;
	now: () => Date;
	logger: HutchLogger;
}

type SelectContentRequest = {
	url: string;
	saveAttemptId: SaveAttemptId;
	candidates?: readonly CandidateReference[];
	liveAttempt?: LiveAttempt;
	extractedAt?: string;
	userId?: string;
} & (
	| { mode: "save" | "recrawl" }
	| { mode: "refresh"; refresh: { etag?: string; lastModified?: string; contentFetchedAt: string; bodyHash: string } }
);

function noReadableReason(params: { selection: PreparedContentSelection; saveAttemptId: SaveAttemptId; liveAttempt?: LiveAttempt }): CrawlFailureReason {
	const { selection, saveAttemptId } = params;
	const httpStatus = selection.sources.find((source) => source.metadata.kind === "live" && source.metadata.attemptId === saveAttemptId)?.metadata.httpStatus;
	if (httpStatus === 404 || httpStatus === 410) return { kind: "not-found", httpStatus };
	if (httpStatus !== undefined && (httpStatus === 429 || isBlockClassStatus(httpStatus))) return { kind: "blocked", cause: blockedCauseForStatus(httpStatus) };
	if (httpStatus === undefined && params.liveAttempt?.failureReason !== undefined) return params.liveAttempt.failureReason;
	return { kind: "parse-error", detail: `no readable article candidate: ${selection.reason}` };
}

export function initSelectContentWork(deps: SelectContentDependencies) {
	const prepare = initPrepareContentSelection(deps);
	const logContentSelection = initLogContentSelection(deps);
	return async (params: SelectContentRequest): Promise<void> => {
		const selection = await prepare(params);
		const expected = selection.article.contentSelection;
		const source = selection.selected;
		if (source === undefined) {
			if (params.liveAttempt?.outcome !== "deferred" && !selection.legacyCanonicalWithheld) {
				await deps.transitionAndPersist(markNoReadableArticle, { url: params.url, input: { reason: noReadableReason({ selection, saveAttemptId: params.saveAttemptId, liveAttempt: params.liveAttempt }) }, selectionExpected: { snapshot: expected } });
			}
			logContentSelection({ saveAttemptId: params.saveAttemptId, selection, liveAttempt: params.liveAttempt });
			return;
		}
		const canonicalContentHash = computeCanonicalContentHash(source.html);
		const crawledAt = deps.now().toISOString();
		const metadata = { ...source.metadata, imageUrl: resolveCanonicalImageUrl({ winner: source, candidates: selection.sources }) };
		const canonicalCommit = { ...(await deps.writeCanonicalContent({ url: params.url, source })), expected };
		if (params.mode === "recrawl" && selection.outcome === "retained") {
			await deps.transitionAndPersist(recrawlTieKeptCanonical, { url: params.url, input: { now: crawledAt }, canonicalCommit });
		} else if (params.mode === "recrawl") {
			await deps.transitionAndPersist(recrawlPromoteTier, {
				url: params.url,
				input: { winnerTier: source.tier, metadata, estimatedReadTime: source.metadata.estimatedReadTime, contentFetchedAt: crawledAt, now: crawledAt, canonicalContentHash },
				canonicalCommit,
			});
		} else if (params.mode === "refresh") {
			await deps.transitionAndPersist(refreshContent, {
				url: params.url,
				input: { metadata, freshness: params.refresh, estimatedReadTime: source.metadata.estimatedReadTime, now: crawledAt, canonicalContentHash },
				canonicalCommit,
			});
		} else {
			await deps.transitionAndPersist(promoteTier, {
				url: params.url,
				input: { tier: source.tier, metadata, estimatedReadTime: source.metadata.estimatedReadTime, contentFetchedAt: crawledAt, now: crawledAt, canonicalChanged: expected?.tier !== source.tier, canonicalContentHash, userId: params.userId },
				canonicalCommit,
			});
		}
		const freshWinner = source.metadata.attemptId === params.saveAttemptId;
		if ((selection.outcome === "selected" && (expected?.tier !== source.tier || canonicalContentHash !== selection.article.freshness.canonicalContentHash)) || (selection.outcome === "retained" && freshWinner)) {
			await deps.recordCrawlVersion({ url: params.url, crawledAt: params.extractedAt ?? crawledAt, authorUserId: source.metadata.authorUserId, canonicalCommit });
		}
		logContentSelection({ saveAttemptId: params.saveAttemptId, selection, liveAttempt: params.liveAttempt });
	};
}

export function initSelectionQueueHandler(queue: {
	tag: string;
	toRequest: (detail: unknown, record: SQSRecord) => SelectContentRequest;
}): (deps: SelectContentDependencies) => Handler<SQSEvent, SQSBatchResponse> {
	return (deps) => {
		const selectContent = initSelectContentWork(deps);
		return async (event) => {
			const batchItemFailures: SQSBatchItemFailure[] = [];
			for (const record of event.Records) {
				try {
					await selectContent(queue.toRequest(JSON.parse(record.body).detail, record));
				} catch (error) {
					deps.logger.error(`[${queue.tag}] record failed`, { messageId: record.messageId, error });
					batchItemFailures.push({ itemIdentifier: record.messageId });
				}
			}
			return { batchItemFailures };
		};
	};
}
