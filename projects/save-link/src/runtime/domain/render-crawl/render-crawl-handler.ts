import assert from "node:assert";
import { createHash } from "node:crypto";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { PrepareArticleIdentity, VerifyWrapperSource } from "@packages/save-article";
import { initCrawlAndFinalizeArticle, type FinalizeArticle } from "@packages/finalize-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { type CrawlArticle, MAX_HTML_BYTES } from "@packages/crawl-article";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { type TransitionAndPersist, markCrawlFailed, markCrawlUnsupported } from "@packages/domain/article-aggregate";
import { RenderCrawlCommand, type LogCrawlOutcome, type LogParseError } from "@packages/hutch-infra-components";
import { initCrawlArchiveCapture } from "../save-link/crawl-archive-capture";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { ConsumePaidCrawlBudget } from "../../providers/paid-crawl-budget/dynamodb-paid-crawl-budget";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { UpdateFetchTimestamp } from "../save-link/update-fetch-timestamp-handler";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import {
	type CrawlTermination,
	type DeferredCrawlContext,
	initCommitDeferredCrawl,
} from "../crawl-article-state/commit-deferred-crawl";
import type { AdoptCanonicalIdentity } from "../save-link/adopt-canonical-identity";
import type { RenderPage, RenderProxy } from "../../providers/render-page/render-page.types";
import { type RenderLadderResult, runRenderLadder } from "./render-ladder";

export function initRenderCrawlHandler(deps: {
	resolveOriginalUrl: (url: string) => Promise<string>;
	prepareArticleIdentity: PrepareArticleIdentity;
	verifyWrapperSource: VerifyWrapperSource;
	crawlArticle: CrawlArticle;
	finalizeArticle: FinalizeArticle;
	putTierSource: PutTierSource;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
	consumeRenderCrawlBudget: ConsumePaidCrawlBudget;
	adoptCanonicalIdentity: AdoptCanonicalIdentity;
	publishEvent: PublishEvent;
	renderPage: RenderPage;
	renderProxy: RenderProxy;
	now: () => Date;
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { logger, logParseError, transitionAndPersist } = deps;
	const logPrefix = "[RenderCrawlCommand]";

	const crawlArchiveCapture = initCrawlArchiveCapture({
		crawlAndFinalizeArticle: initCrawlAndFinalizeArticle({ crawlArticle: deps.crawlArticle, finalizeArticle: deps.finalizeArticle }),
		putTierSource: deps.putTierSource,
		readTierSnapshot: deps.readTierSnapshot,
		logCrawlOutcome: deps.logCrawlOutcome,
		publishEvent: deps.publishEvent,
		logger,
		now: deps.now,
		verifyWrapperSource: deps.verifyWrapperSource,
	});

	const {
		commitFetchedBody,
		resolveUnreadable,
		resolveBudgetExhausted,
		resolveBlocked,
		publishArchiveComparison,
		emitTier1FailureOutcome,
	} = initCommitDeferredCrawl({
		resolveOriginalUrl: deps.resolveOriginalUrl,
		finalizeArticle: deps.finalizeArticle,
		putTierSource: deps.putTierSource,
		updateFetchTimestamp: deps.updateFetchTimestamp,
		transitionAndPersist,
		markCrawlStage: deps.markCrawlStage,
		adoptCanonicalIdentity: deps.adoptCanonicalIdentity,
		publishEvent: deps.publishEvent,
		now: deps.now,
		logger,
		logParseError,
		logCrawlOutcome: deps.logCrawlOutcome,
		readTierSnapshot: deps.readTierSnapshot,
		logPrefix,
	});

	const backOffRefresh = async (ctx: DeferredCrawlContext): Promise<void> => {
		if (!ctx.refresh) return;
		await deps.updateFetchTimestamp({
			url: ctx.url,
			contentFetchedAt: deps.now().toISOString(),
			bodyHash: ctx.previousBodyHash,
		});
	};

	const settleWithoutBody = async (rendered: RenderLadderResult, ctx: DeferredCrawlContext): Promise<CrawlTermination> => {
		const { url } = ctx;
		if (ctx.candidates !== undefined) return publishArchiveComparison({ ...ctx, candidates: ctx.candidates });
		if (rendered.kind === "rendered") {
			const bytes = Buffer.byteLength(rendered.html);
			logParseError({
				url,
				reason: `crawl-unsupported: content body too large after render (${rendered.renderedThrough}): ${bytes} bytes (cap ${MAX_HTML_BYTES.bytes} bytes)`,
			});
			await emitTier1FailureOutcome({ url });
			await transitionAndPersist(markCrawlUnsupported, { url, input: { reason: { kind: "content-too-large", bytes } } });
			return { via: "committed-in-process" };
		}
		const { direct, proxied } = rendered;
		if (proxied.kind === "blocked") return resolveBlocked({ url, httpStatus: proxied.httpStatus });
		if (direct.kind === "blocked") return resolveBlocked({ url, httpStatus: direct.httpStatus });
		const detail = `render-failed: direct-egress: ${direct.detail}; residential-proxy: ${proxied.detail}`;
		logParseError({ url, reason: detail });
		await emitTier1FailureOutcome({ url });
		await transitionAndPersist(markCrawlFailed, {
			url,
			input: { reason: { kind: "fetch-failed", detail, httpStatus: proxied.httpStatus ?? direct.httpStatus } },
		});
		return { via: "committed-in-process" };
	};

	const resolveRender = async (rendered: RenderLadderResult, ctx: DeferredCrawlContext): Promise<CrawlTermination> => {
		const { url } = ctx;
		if (rendered.kind === "rendered") {
			logger.info(`${logPrefix} rendered`, { url, renderedThrough: rendered.renderedThrough, httpStatus: rendered.httpStatus });
		} else {
			logger.info(`${logPrefix} not rendered on either leg`, { url, direct: rendered.direct, proxied: rendered.proxied });
		}
		if (rendered.kind !== "rendered" || Buffer.byteLength(rendered.html) > MAX_HTML_BYTES.bytes) {
			const settled = await settleWithoutBody(rendered, ctx);
			await backOffRefresh(ctx);
			return settled;
		}
		const { renderedThrough } = rendered;
		const committed = await commitFetchedBody(
			{
				html: rendered.html,
				bodyHash: createHash("sha256").update(rendered.html).digest("hex"),
				finalUrl: rendered.finalUrl,
				httpStatus: rendered.httpStatus,
				renderedThrough,
			},
			ctx,
		);
		if (committed.via !== "unreadable") return committed;
		const unreadable = await resolveUnreadable({ url, detail: `no readable article after render (${renderedThrough}): ${committed.reason}` });
		await backOffRefresh(ctx);
		return unreadable;
	};

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = RenderCrawlCommand.detailSchema.parse(envelope.detail);
				const { url, userId, recrawl, refresh, saveAttemptId, previousBodyHash } = detail;
				const identity = await deps.prepareArticleIdentity(url);
				assert(identity.status === "resolved", "queued render article original is unresolved");
				let candidates = detail.candidates;
				if (candidates === undefined && !refresh && identity.contentSourceUrl !== undefined) {
					const capture = await crawlArchiveCapture({
						url,
						captureUrl: identity.contentSourceUrl,
						sourceOriginalUrl: identity.sourceOriginalUrl,
						saveAttemptId,
					});
					candidates = capture === undefined ? [] : [capture];
				}

				logger.info(`${logPrefix} processing`, {
					url,
					recrawl: recrawl ? 1 : 0,
					refresh: refresh ? 1 : 0,
				});

				const ctx: DeferredCrawlContext = {
					url,
					originalUrl: identity.originalUrl,
					saveAttemptId,
					candidates,
					refresh,
					recrawl,
					userId,
					previousBodyHash,
				};
				const budget = await deps.consumeRenderCrawlBudget({ messageId: record.messageId });
				if (!budget.allowed) {
					logger.warn(`${logPrefix} render-crawl budget exhausted — failing crawl gracefully`, { url });
					await resolveBudgetExhausted(ctx);
					await backOffRefresh(ctx);
					continue;
				}

				const rendered = await runRenderLadder({
					renderPage: deps.renderPage,
					url: identity.originalUrl,
					proxy: deps.renderProxy,
				});
				await resolveRender(rendered, ctx);
			} catch (error) {
				logger.error(`${logPrefix} record failed`, {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
