import assert from "node:assert";
import { createHash } from "node:crypto";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { PrepareArticleIdentity, VerifyWrapperSource } from "@packages/save-article";
import { initCrawlAndFinalizeArticle, type FinalizeArticle } from "@packages/finalize-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { type CrawlArticle, type CrawlUnsupportedReason, MAX_HTML_BYTES } from "@packages/crawl-article";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { type TransitionAndPersist, markCrawlFailed, markCrawlUnsupported } from "@packages/domain/article-aggregate";
import { ComprehensiveCrawlCommand, RenderCrawlCommand, type LogCrawlOutcome, type LogParseError } from "@packages/hutch-infra-components";
import { initCrawlArchiveCapture } from "../save-link/crawl-archive-capture";
import { deferJavascriptShells } from "../save-link/javascript-shell";
import { terminalUnsupportedReason } from "../save-link/terminal-unsupported-reason";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { ConsumePaidCrawlBudget } from "../../providers/paid-crawl-budget/dynamodb-paid-crawl-budget";
import type { PutTierSource } from "@packages/tier-source";
import type { UpdateFetchTimestamp } from "../save-link/update-fetch-timestamp-handler";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import {
	type CrawlTermination,
	type DeferredCrawlContext,
	initCommitDeferredCrawl,
} from "../crawl-article-state/commit-deferred-crawl";
import type { AdoptCanonicalIdentity } from "../save-link/adopt-canonical-identity";
import type { RenderPage, ResidentialEgress, WebUnlockerEgress } from "../../providers/render-page/render-page.types";
import {
	type Escalation,
	type FetchLegReport,
	type LadderRender,
	type ProxiedFetchAttempt,
	type RenderCommit,
	type RenderLadderResult,
	type RenderLegReport,
	runRenderLadder,
} from "./render-ladder";

type Unrendered = Extract<RenderLadderResult, { kind: "unrendered" }>;

export function initRenderCrawlHandler(deps: {
	resolveOriginalUrl: (url: string) => Promise<string>;
	prepareArticleIdentity: PrepareArticleIdentity;
	verifyWrapperSource: VerifyWrapperSource;
	crawlArticle: CrawlArticle;
	proxiedCrawlArticle: CrawlArticle;
	finalizeArticle: FinalizeArticle;
	putTierSource: PutTierSource;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
	consumeRenderCrawlBudget: ConsumePaidCrawlBudget;
	adoptCanonicalIdentity: AdoptCanonicalIdentity;
	publishEvent: PublishEvent;
	renderPage: RenderPage;
	residentialEgress: () => ResidentialEgress;
	webUnlockerEgress: WebUnlockerEgress;
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
		commitReadableBody,
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

	const proxiedCrawlAndFinalize = deferJavascriptShells({
		crawlAndFinalizeArticle: initCrawlAndFinalizeArticle({ crawlArticle: deps.proxiedCrawlArticle, finalizeArticle: deps.finalizeArticle }),
	});

	const backOffRefresh = async (ctx: DeferredCrawlContext): Promise<void> => {
		if (!ctx.refresh) return;
		await deps.updateFetchTimestamp({
			url: ctx.url,
			contentFetchedAt: deps.now().toISOString(),
			bodyHash: ctx.previousBodyHash,
		});
	};

	const settleProxiedUnsupported = async (reason: CrawlUnsupportedReason | undefined, ctx: DeferredCrawlContext): Promise<ProxiedFetchAttempt> => {
		const { url } = ctx;
		if (reason?.kind === "javascript-required") return { kind: "no-body", outcome: reason.kind };
		const terminalReason = terminalUnsupportedReason(reason);
		if (terminalReason === undefined) {
			await deps.markCrawlStage({ url, stage: "comprehensive-fetching" });
			await deps.publishEvent(ComprehensiveCrawlCommand, {
				url,
				userId: ctx.userId,
				recrawl: ctx.recrawl,
				refresh: ctx.refresh,
				previousBodyHash: ctx.previousBodyHash,
				saveAttemptId: ctx.saveAttemptId,
				candidates: ctx.candidates,
			});
			logger.info(`${logPrefix} proxied fetch deferred to comprehensive crawl`, { url, unsupportedReason: reason?.kind });
			return { kind: "settled" };
		}
		if (ctx.candidates !== undefined) {
			await publishArchiveComparison({ ...ctx, candidates: ctx.candidates });
		} else {
			await emitTier1FailureOutcome({ url });
			await transitionAndPersist(markCrawlUnsupported, { url, input: { reason: terminalReason } });
		}
		await backOffRefresh(ctx);
		return { kind: "settled" };
	};

	const fetchThroughWebUnlocker = async (ctx: DeferredCrawlContext): Promise<ProxiedFetchAttempt> => {
		const { url } = ctx;
		const result = await proxiedCrawlAndFinalize({
			url: ctx.originalUrl,
			writeContext: { url, attemptId: ctx.saveAttemptId },
			retainResponseBody: true,
		});
		if (result.status === "unsupported") return settleProxiedUnsupported(result.unsupportedReason, ctx);
		if (result.status !== "fetched") return { kind: "no-body", outcome: result.status };
		const httpStatus = result.httpStatus ?? 0;
		if (result.parseFailure !== undefined || httpStatus < 200 || httpStatus >= 300) return { kind: "no-body", outcome: "unreadable" };
		assert(result.evaluationHtml !== undefined, "a retained proxied fetch carries its response body");
		const fetched = {
			etag: result.etag,
			lastModified: result.lastModified,
			bodyHash: result.bodyHash,
			finalUrl: result.finalUrl,
			httpStatus,
			renderedThrough: "web-unlocker-fetch" as const,
		};
		const { directResourceKind } = result.article.metadata;
		const committed = await commitReadableBody(
			directResourceKind === "image"
				? { ...fetched, html: result.article.html, mediaType: "image" }
				: directResourceKind === "plain-text"
					? { ...fetched, html: result.evaluationHtml, mediaType: "plain-text", plainText: result.evaluationHtml }
					: { ...fetched, html: result.evaluationHtml },
			ctx,
		);
		if (committed.via === "unreadable") return { kind: "no-body", outcome: "unreadable" };
		logger.info(`${logPrefix} fetched`, { url, fetchedThrough: "web-unlocker-fetch", httpStatus });
		return { kind: "committed" };
	};

	const settleTooLarge = async (render: LadderRender, ctx: DeferredCrawlContext): Promise<void> => {
		const { url } = ctx;
		if (ctx.candidates !== undefined) {
			await publishArchiveComparison({ ...ctx, candidates: ctx.candidates });
			return;
		}
		const bytes = Buffer.byteLength(render.html);
		logParseError({
			url,
			reason: `crawl-unsupported: content body too large after render (${render.renderedThrough}): ${bytes} bytes (cap ${MAX_HTML_BYTES.bytes} bytes)`,
		});
		await emitTier1FailureOutcome({ url });
		await transitionAndPersist(markCrawlUnsupported, { url, input: { reason: { kind: "content-too-large", bytes } } });
	};

	const commitRender = async (render: LadderRender, escalation: Escalation, ctx: DeferredCrawlContext): Promise<RenderCommit> => {
		const { url } = ctx;
		const { renderedThrough } = render;
		logger.info(`${logPrefix} rendered`, { url, renderedThrough, httpStatus: render.httpStatus, requests: render.requests });
		if (Buffer.byteLength(render.html) > MAX_HTML_BYTES.bytes) {
			await settleTooLarge(render, ctx);
			await backOffRefresh(ctx);
			return { kind: "settled" };
		}
		const body = {
			html: render.html,
			bodyHash: createHash("sha256").update(render.html).digest("hex"),
			finalUrl: render.finalUrl,
			httpStatus: render.httpStatus,
			renderedThrough,
		};
		const committed = escalation === "available" ? await commitReadableBody(body, ctx) : await commitFetchedBody(body, ctx);
		if (committed.via !== "unreadable") return { kind: "settled" };
		const detail = `no readable article after render (${renderedThrough}): ${committed.reason}`;
		if (escalation === "available") return { kind: "unreadable", detail };
		await resolveUnreadable({ url, detail });
		await backOffRefresh(ctx);
		return { kind: "settled" };
	};

	const legDetail = (report: Exclude<RenderLegReport | FetchLegReport, { kind: "blocked" }>): string =>
		report.kind === "skipped" ? `skipped (${report.reason})` : report.kind === "no-body" ? report.outcome : report.detail;

	const settleWithoutBody = async (rendered: Unrendered, ctx: DeferredCrawlContext): Promise<CrawlTermination> => {
		const { url } = ctx;
		if (ctx.candidates !== undefined) return publishArchiveComparison({ ...ctx, candidates: ctx.candidates });
		const { direct, residential, webUnlockerFetch, webUnlockerRender } = rendered;
		if (webUnlockerRender.kind === "blocked") return resolveBlocked({ url, httpStatus: webUnlockerRender.httpStatus });
		if (residential.kind === "blocked") return resolveBlocked({ url, httpStatus: residential.httpStatus });
		if (direct.kind === "blocked") return resolveBlocked({ url, httpStatus: direct.httpStatus });
		const renderLegs = [webUnlockerRender, residential, direct];
		const detail = [
			`render-failed: direct-egress: ${legDetail(direct)}`,
			`residential-per-gb: ${legDetail(residential)}`,
			`web-unlocker-fetch: ${legDetail(webUnlockerFetch)}`,
			`web-unlocker-render: ${legDetail(webUnlockerRender)}`,
		].join("; ");
		const httpStatus = renderLegs.find((leg) => leg.kind === "failed" && leg.httpStatus !== undefined);
		logParseError({ url, reason: detail });
		await emitTier1FailureOutcome({ url });
		await transitionAndPersist(markCrawlFailed, {
			url,
			input: { reason: { kind: "fetch-failed", detail, httpStatus: httpStatus?.kind === "failed" ? httpStatus.httpStatus : undefined } },
		});
		return { via: "committed-in-process" };
	};

	const resolveLadder = async (rendered: RenderLadderResult, ctx: DeferredCrawlContext): Promise<void> => {
		const { url } = ctx;
		if (rendered.kind === "settled") return;
		if (rendered.kind === "budget-exhausted") {
			logger.warn(`${logPrefix} render-crawl budget exhausted — failing crawl gracefully`, { url, direct: rendered.direct });
			await resolveBudgetExhausted(ctx);
			await backOffRefresh(ctx);
			return;
		}
		const { direct, residential, webUnlockerFetch, webUnlockerRender } = rendered;
		logger.info(`${logPrefix} not rendered on any leg`, { url, direct, residential, webUnlockerFetch, webUnlockerRender });
		const outOfTime = Object.entries({ residential, webUnlockerFetch, webUnlockerRender })
			.filter(([, report]) => report.kind === "skipped" && report.reason === "time-exhausted")
			.map(([leg]) => leg);
		if (outOfTime.length > 0) logger.warn(`${logPrefix} render ladder ran out of time`, { url, skippedLegs: outOfTime });
		await settleWithoutBody(rendered, ctx);
		await backOffRefresh(ctx);
	};

	return async (event, context): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = RenderCrawlCommand.detailSchema.parse(envelope.detail);
				const { url, userId, recrawl, refresh, saveAttemptId, previousBodyHash, unsupportedReason } = detail;
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
				const rendered = await runRenderLadder({
					renderPage: deps.renderPage,
					url: identity.originalUrl,
					residentialEgress: deps.residentialEgress,
					webUnlockerEgress: deps.webUnlockerEgress,
					unsupportedReason,
					commitRender: (render, escalation) => commitRender(render, escalation, ctx),
					fetchThroughWebUnlocker: () => fetchThroughWebUnlocker(ctx),
					consumeBudget: () => deps.consumeRenderCrawlBudget({ messageId: record.messageId }),
					remainingMilliseconds: () => context.getRemainingTimeInMillis(),
				});
				await resolveLadder(rendered, ctx);
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
