import { setTimeout } from "node:timers/promises";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { type SaveAttemptId, hasWrapperShape } from "@packages/domain/article";
import { blockedCauseForStatus, type CrawlFailureReason } from "@packages/article-state-types";
import { type FetchYouTubeVideoCard, isBlockClassStatus } from "@packages/crawl-article";
import { estimatedReadTimeFromWordCount } from "@packages/finalize-article";
import { formatErrorLogLine, type Logger } from "@packages/logger";
import { type DeepseekCallFailedLogLine, describeAiProviderError, deepseekCallFailedLogLine } from "@packages/ai-message";
import type { VerifyWrapperSource } from "@packages/save-article";
import {
	type LoadArticle,
	type SelectionConflict,
	SelectionSnapshotChangedError,
	type TransitionAndPersist,
	markCrawlAwaitingReader,
	markCrawlExhausted,
	promoteTier,
	recrawlPromoteTier,
	recrawlTieKeptCanonical,
	refreshContent,
	shownMetadataOf,
} from "@packages/domain/article-aggregate";
import type { ListAvailableTierSources, CandidateReference } from "./list-available-tier-sources";
import type { SelectMostCompleteContent } from "./select-content";
import type { WriteCanonicalContent } from "./tier-source-access.types";
import type { RecordCrawlVersion } from "./crawl-versions";
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";
import { resolveCanonicalImageUrl } from "./resolve-canonical-image-url";
import { resolveCanonicalPublishedOn } from "./resolve-canonical-published-on";
import { type LiveAttempt, type PreparedContentSelection, type SelectionMode, initLogContentSelection, initPrepareContentSelection } from "./prepare-content-selection";
import { markNoReadableArticle } from "./mark-no-readable-article";
import { SELECT_CONTENT_MAX_RECEIVE_COUNT } from "./max-receive-count";
import { SELECT_CONTENT_TIMEOUTS } from "./timeouts";
import { initJudgeUnderLedger } from "./judge-under-ledger";
import type { RunMeteredLeg } from "../metered-leg/run-metered-leg";
import type { FindArticleContent } from "../save-link/article-content.types";
import { candidateProvenance, type PutTierSource, type VerifiedTierSource } from "@packages/tier-source";

export interface SelectContentDependencies {
	listAvailableTierSources: ListAvailableTierSources;
	selectMostCompleteContent: SelectMostCompleteContent;
	runMeteredLeg: RunMeteredLeg;
	writeCanonicalContent: WriteCanonicalContent;
	recordCrawlVersion: RecordCrawlVersion;
	loadArticle: LoadArticle;
	readCanonicalContent: FindArticleContent;
	transitionAndPersist: TransitionAndPersist;
	resolveOriginalUrl: (url: string) => Promise<string>;
	verifyWrapperSource: VerifyWrapperSource;
	fetchYouTubeVideoCard: FetchYouTubeVideoCard;
	putTierSource: PutTierSource;
	now: () => Date;
	logger: Logger;
}

type SelectContentRequest = {
	url: string;
	saveAttemptId: SaveAttemptId;
	liveAttempt?: LiveAttempt;
	extractedAt?: string;
} & (
	| { mode: Extract<SelectionMode, "save">; candidates?: readonly CandidateReference[] }
	| { mode: Extract<SelectionMode, "recrawl">; candidates: readonly CandidateReference[] }
	| { mode: Extract<SelectionMode, "refresh">; candidates?: readonly CandidateReference[]; refresh: { etag?: string; lastModified?: string; contentFetchedAt: string; bodyHash: string } }
);

type DecidedSelection =
	| { kind: "refused" }
	| { kind: "settled"; selection: PreparedContentSelection }
	| { kind: "committed"; selection: PreparedContentSelection; version: Parameters<RecordCrawlVersion>[0] | undefined };

const MAX_DECISION_ATTEMPTS = 3;
const DECISION_RETRY_DELAY_MS = 25;
const COMMIT_RESERVE_MS = 5_000;

function freshTierOneDisplay(params: { selection: PreparedContentSelection; candidates: readonly CandidateReference[] }) {
	const { selection } = params;
	const candidateIds = new Set(params.candidates.map((candidate) => candidate.id));
	const fresh = selection.selectionRule === "unchanged-content" && selection.selected?.tier === "tier-1"
		? selection.sources.find((source) => source.tier === "tier-1" && candidateIds.has(source.metadata.id) && !hasWrapperShape(source.metadata.sourceUrl))
		: undefined;
	return fresh === undefined
		? { kind: "row" } as const
		: { kind: "fresh", shown: shownMetadataOf(fresh.metadata) } as const;
}

function noReadableReason(params: { selection: PreparedContentSelection; saveAttemptId: SaveAttemptId; liveAttempt?: LiveAttempt }): CrawlFailureReason {
	const { selection, saveAttemptId } = params;
	const detail = `no readable article candidate: ${selection.reason}`;
	if (selection.sources.some((source) => source.tier === "tier-0" && source.metadata.captureTrigger !== "automatic" && source.metadata.attemptId === saveAttemptId)) return { kind: "capture-unreadable", detail };
	const live = selection.sources.find((source) => source.metadata.kind === "live" && source.metadata.attemptId === saveAttemptId)?.metadata;
	const httpStatus = live?.httpStatus;
	if (httpStatus === 404 || httpStatus === 410) return { kind: "not-found", httpStatus };
	if (httpStatus !== undefined && (httpStatus === 429 || isBlockClassStatus(httpStatus))) return { kind: "blocked", cause: blockedCauseForStatus(httpStatus) };
	if (httpStatus === undefined && params.liveAttempt?.failureReason !== undefined) return params.liveAttempt.failureReason;
	const renderedThrough = live?.renderedThrough;
	if (renderedThrough !== undefined) return { kind: "parse-error", detail: `no readable article candidate after render (${renderedThrough}): ${selection.reason}` };
	return { kind: "parse-error", detail };
}

async function recoverVideoCard(deps: SelectContentDependencies, params: { url: string; saveAttemptId: SaveAttemptId; originalUrl: string }): Promise<VerifiedTierSource | undefined> {
	const card = await deps.fetchYouTubeVideoCard({ url: params.originalUrl });
	if (card === undefined) return undefined;
	const metadata = candidateProvenance({
		metadata: { title: card.title, siteName: "YouTube", excerpt: card.excerpt, wordCount: 0, estimatedReadTime: estimatedReadTimeFromWordCount(0), imageUrl: card.posterUrl },
		html: card.html, evaluationHtml: card.html, attemptId: params.saveAttemptId, originalUrl: params.originalUrl, sourceUrl: card.watchUrl, kind: "live", fetchedAt: deps.now().toISOString(), httpStatus: 200,
	});
	const persisted = await deps.putTierSource({ url: params.url, tier: "tier-1", html: card.html, evaluationHtml: card.html, metadata });
	return { tier: "tier-1", html: card.html, evaluationHtml: card.html, metadata: persisted };
}

export function initSelectContentWork(deps: SelectContentDependencies) {
	const judge = initJudgeUnderLedger({ selectMostCompleteContent: deps.selectMostCompleteContent, runMeteredLeg: deps.runMeteredLeg, claimTtlMs: SELECT_CONTENT_TIMEOUTS.sqsVisibilitySeconds * 1000 });
	const prepare = initPrepareContentSelection({ ...deps, judge });
	const logContentSelection = initLogContentSelection(deps);
	const decideAndCommit = async (params: SelectContentRequest & { claimId: string; beforeProviderCall?: () => void }): Promise<DecidedSelection> => {
		const prepared = await prepare(params);
		if (prepared.outcome === "refused") {
			deps.logger.info("[RefreshContentExtracted] refused", { url: params.url, saveAttemptId: params.saveAttemptId, reason: prepared.reason, rowFetchedAt: prepared.article.freshness.contentFetchedAt, extractedAt: params.extractedAt });
			return { kind: "refused" };
		}
		const keepRow = params.liveAttempt?.outcome === "deferred" || prepared.legacyCanonicalWithheld;
		const nothingReadable = prepared.selected === undefined && !keepRow && prepared.selectionRule !== "judge-deferred";
		const card = nothingReadable ? await recoverVideoCard(deps, { url: params.url, saveAttemptId: params.saveAttemptId, originalUrl: prepared.originalUrl }) : undefined;
		const selection: PreparedContentSelection = card === undefined ? prepared : {
			...prepared, selected: card, outcome: "selected", selectionRule: "video-card-fallback", sources: [...prepared.sources, card],
			readableIds: new Set([...prepared.readableIds, card.metadata.id]), reason: `no readable candidate (${prepared.reason}); served the oEmbed video card`,
		};
		const expected = selection.article.contentSelection;
		const source = selection.selected;
		if (source === undefined) {
			if (!keepRow && selection.selectionRule === "judge-deferred") {
				await deps.transitionAndPersist(markCrawlAwaitingReader, { url: params.url, input: { deferredLeg: "content-judge" }, selectionExpected: { snapshot: expected } });
			} else if (nothingReadable) {
				await deps.transitionAndPersist(markNoReadableArticle, { url: params.url, input: { reason: noReadableReason({ selection, saveAttemptId: params.saveAttemptId, liveAttempt: params.liveAttempt }) }, selectionExpected: { snapshot: expected } });
			}
			return { kind: "settled", selection };
		}
		const canonicalContentHash = computeCanonicalContentHash(source.html);
		const crawledAt = deps.now().toISOString();
		const metadata = { ...source.metadata, imageUrl: resolveCanonicalImageUrl({ winner: source, candidates: selection.sources }), publishedOn: resolveCanonicalPublishedOn({ winner: source, candidates: selection.sources }) };
		const display = selection.outcome === "retained" ? { kind: "row" } as const : { kind: "candidate" } as const;
		const canonicalCommit = { ...(await deps.writeCanonicalContent({ url: params.url, source })), originalUrl: selection.originalUrl, expected };
		if (params.mode === "recrawl" && selection.outcome === "retained") {
			await deps.transitionAndPersist(recrawlTieKeptCanonical, { url: params.url, input: { now: crawledAt, publishedOn: metadata.publishedOn, display: freshTierOneDisplay({ selection, candidates: params.candidates }) }, canonicalCommit });
		} else if (params.mode === "recrawl") {
			await deps.transitionAndPersist(recrawlPromoteTier, {
				url: params.url,
				input: { winnerTier: source.tier, metadata, estimatedReadTime: source.metadata.estimatedReadTime, contentFetchedAt: crawledAt, now: crawledAt, canonicalContentHash },
				canonicalCommit,
			});
		} else if (params.mode === "refresh") {
			await deps.transitionAndPersist(refreshContent, {
				url: params.url,
				input: { display, metadata, freshness: params.refresh, estimatedReadTime: source.metadata.estimatedReadTime, now: crawledAt, canonicalContentHash },
				canonicalCommit,
			});
		} else {
			await deps.transitionAndPersist(promoteTier, {
				url: params.url,
				input: { tier: source.tier, display, metadata, estimatedReadTime: source.metadata.estimatedReadTime, contentFetchedAt: crawledAt, now: crawledAt, canonicalChanged: expected?.tier !== source.tier, canonicalContentHash },
				canonicalCommit,
			});
		}
		const freshWinner = source.metadata.attemptId === params.saveAttemptId;
		const changedBody = (selection.outcome === "selected" && (expected?.tier !== source.tier || canonicalContentHash !== selection.article.freshness.canonicalContentHash)) || (selection.outcome === "retained" && freshWinner);
		return { kind: "committed", selection, version: changedBody ? { url: params.url, crawledAt: params.extractedAt ?? crawledAt, authorUserId: source.metadata.authorUserId, canonicalCommit } : undefined };
	};
	const decideWithinBudget = async (params: SelectContentRequest & { claimId: string; remainingTimeMs: () => number }): Promise<DecidedSelection> => {
		const conflicts: SelectionConflict[] = [];
		const beforeProviderCall = () => {
			const remainingMs = params.remainingTimeMs();
			if (remainingMs < SELECT_CONTENT_TIMEOUTS.deepseekMs + COMMIT_RESERVE_MS) {
				throw new Error(`[SelectContent] ${remainingMs} ms left after a changed selection snapshot (${conflicts.join(", ")}); a fresh content judge call needs ${SELECT_CONTENT_TIMEOUTS.deepseekMs + COMMIT_RESERVE_MS} ms`);
			}
		};
		for (;;) {
			try {
				const decided = await decideAndCommit({ ...params, beforeProviderCall: conflicts.length === 0 ? undefined : beforeProviderCall });
				if (conflicts.length > 0) deps.logger.info("[SelectContent] recovered a changed selection snapshot", { url: params.url, saveAttemptId: params.saveAttemptId, conflicts, attempts: conflicts.length + 1 });
				return decided;
			} catch (error) {
				if (!(error instanceof SelectionSnapshotChangedError) || conflicts.length + 1 >= MAX_DECISION_ATTEMPTS || params.remainingTimeMs() < COMMIT_RESERVE_MS + DECISION_RETRY_DELAY_MS) throw error;
				conflicts.push(error.conflict);
				await setTimeout(DECISION_RETRY_DELAY_MS);
			}
		}
	};
	return async (params: SelectContentRequest & { claimId: string; remainingTimeMs: () => number }): Promise<void> => {
		const decided = await decideWithinBudget(params);
		if (decided.kind === "refused") return;
		if (decided.kind === "committed" && decided.version !== undefined) await deps.recordCrawlVersion(decided.version);
		logContentSelection({ saveAttemptId: params.saveAttemptId, selection: decided.selection, liveAttempt: params.liveAttempt });
	};
}

export function initSelectionQueueHandler(queue: {
	tag: string;
	feature: "select-most-complete-content" | "recrawl-content-extracted" | "refresh-content-extracted" | "reselect-after-removal";
	toRequest: (detail: unknown, record: SQSRecord) => SelectContentRequest;
	onExhaustion: "mark-crawl-exhausted" | "keep-row";
}): (deps: SelectContentDependencies & { deepseekCallFailedLog: Logger.Typed<DeepseekCallFailedLogLine> }) => Handler<SQSEvent, SQSBatchResponse> {
	return (deps) => {
		const selectContent = initSelectContentWork(deps);
		return async (event, context) => {
			const batchItemFailures: SQSBatchItemFailure[] = [];
			for (const record of event.Records) {
				let recordUrl: string | undefined;
				try {
					const request = queue.toRequest(JSON.parse(record.body).detail, record);
					recordUrl = request.url;
					await selectContent({ ...request, claimId: record.messageId, remainingTimeMs: () => context.getRemainingTimeInMillis() });
				} catch (error) {
					deps.logger.error(`[${queue.tag}] record failed`, { messageId: record.messageId, error });
					const receiveCount = Number(record.attributes.ApproximateReceiveCount);
					const failure = describeAiProviderError(error);
					if (failure.kind !== "unknown") {
						deps.deepseekCallFailedLog.error(deepseekCallFailedLogLine({
							feature: queue.feature,
							failure,
							receiveCount,
							messageId: record.messageId,
							ids: {},
						}));
					}
					if (queue.onExhaustion === "mark-crawl-exhausted" && recordUrl !== undefined && receiveCount >= SELECT_CONTENT_MAX_RECEIVE_COUNT) {
						try {
							await deps.transitionAndPersist(markCrawlExhausted, {
								url: recordUrl,
								input: { reason: { kind: "exhausted-retries", receiveCount } as const, receiveCount },
							});
							deps.logger.error(formatErrorLogLine({
								message: `[${queue.tag}] dead-lettered after ${receiveCount} receives (messageId ${record.messageId}); marking crawl exhausted`,
								url: recordUrl,
								now: deps.now,
							}));
						} catch (markError) {
							deps.logger.error(formatErrorLogLine({
								message: `[${queue.tag}] exhausted-mark record failed on receive ${receiveCount} (messageId ${record.messageId})`,
								url: recordUrl,
								error: markError instanceof Error ? markError : new Error(String(markError)),
								now: deps.now,
							}));
						}
					}
					batchItemFailures.push({ itemIdentifier: record.messageId });
				}
			}
			return { batchItemFailures };
		};
	};
}
