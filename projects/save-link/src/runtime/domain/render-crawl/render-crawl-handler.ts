import assert from "node:assert";
import { createHash } from "node:crypto";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { PrepareArticleIdentity, VerifyWrapperSource } from "@packages/save-article";
import { initCrawlAndFinalizeArticle, type FinalizeArticle } from "@packages/finalize-article";
import type { Logger } from "@packages/logger";
import { type CrawlArticle, type CrawlUnsupportedReason, MAX_HTML_BYTES } from "@packages/crawl-article";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import {
	type TransitionAndPersist,
	markCrawlAwaitingReader,
	markCrawlBlocked,
	markCrawlExhausted,
	markCrawlUnsupported,
} from "@packages/domain/article-aggregate";
import { CandidateIdSchema } from "@packages/domain/article";
import { ContentTierSchema } from "@packages/article-state-types";
import type {
	ClaimMeteredLeg,
	PaidLegPermit,
	ReleaseMeteredLeg,
	SettleMeteredLeg,
} from "@packages/provider-contracts/metered-leg-ledger";
import { z } from "zod";
import { legInputHash } from "../metered-leg/leg-input-hash";
import { logMeteredLeg, REFUSED_CLAIM_ACTION } from "../metered-leg/metered-leg-line";
import { RENDER_CRAWL_TIMEOUTS } from "./timeouts";
import { ComprehensiveCrawlCommand, RenderCrawlCommand, type LogCrawlOutcome, type LogParseError } from "@packages/infra-components";
import { initCrawlArchiveCapture } from "../save-link/crawl-archive-capture";
import { deferJavascriptShells } from "../save-link/javascript-shell";
import { terminalUnsupportedReason } from "../save-link/terminal-unsupported-reason";
import type { MarkCrawlStage } from "../../domain/crawl-article-state/crawl-stage.types";
import type { ConsumePaidCrawlBudget } from "../comprehensive-crawl/paid-crawl-budget.types";
import type { PutTierSource } from "@packages/tier-source";
import type { UpdateFetchTimestamp } from "../save-link/update-fetch-timestamp-handler";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import {
	type CrawlTermination,
	type DeferredCrawlContext,
	initCommitDeferredCrawl,
} from "../crawl-article-state/commit-deferred-crawl";
import type { AdoptCanonicalIdentity } from "../save-link/adopt-canonical-identity";
import type { BrowserEgress, RenderOutcome, RenderPage, ResidentialEgress, WebUnlockerEgress } from "./render-page.types";
import {
	type Escalation,
	type FetchLegReport,
	type LadderRender,
	type ProxiedFetchAttempt,
	type RenderCommit,
	type RenderLadderResult,
	type RenderLegClaim,
	type RenderLegReport,
	type RenderMeteredLeg,
	runRenderLadder,
} from "./render-ladder";
import type { ProxiedRenderLeg, ReportProxiedRenderAttempt } from "./report-proxied-render-attempt";

const PROXIED_RENDER_LEG: Record<Exclude<BrowserEgress["kind"], "direct">, ProxiedRenderLeg> = {
	residential: "residential-per-gb",
	"web-unlocker": "web-unlocker-render",
};

function withoutResourceHosts({ resourceHosts: _resourceHosts, ...outcome }: RenderOutcome) {
	return outcome;
}

const loggedLeg = (report: RenderLegReport) => (report.kind === "skipped" ? report : withoutResourceHosts(report));

type Unrendered = Extract<RenderLadderResult, { kind: "unrendered" }>;

const RecordedCandidateSchema = z.object({ id: CandidateIdSchema, tier: ContentTierSchema });

export function initRenderCrawlHandler(deps: {
	resolveOriginalUrl: (url: string) => Promise<string>;
	prepareArticleIdentity: PrepareArticleIdentity;
	findAdoptedFetchUrl: (url: string) => Promise<string | undefined>;
	verifyWrapperSource: VerifyWrapperSource;
	crawlArticle: CrawlArticle;
	proxiedCrawlArticle: CrawlArticle;
	finalizeArticle: FinalizeArticle;
	putTierSource: PutTierSource;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
	consumeRenderCrawlBudget: ConsumePaidCrawlBudget;
	claimMeteredLeg: ClaimMeteredLeg;
	settleMeteredLeg: SettleMeteredLeg;
	releaseMeteredLeg: ReleaseMeteredLeg;
	adoptCanonicalIdentity: AdoptCanonicalIdentity;
	publishEvent: PublishEvent;
	renderPage: RenderPage;
	residentialEgress: (permit: PaidLegPermit) => ResidentialEgress;
	webUnlockerEgress: WebUnlockerEgress;
	reportProxiedRenderAttempt: ReportProxiedRenderAttempt;
	now: () => Date;
	logger: Logger;
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

	const resumableTarget = async (params: { url: string; observedUrl: string | undefined }): Promise<string | undefined> => {
		if (params.observedUrl === undefined) return undefined;
		const pinned = await deps.findAdoptedFetchUrl(params.url);
		return pinned === undefined ? params.observedUrl : undefined;
	};

	const fetchThroughWebUnlocker = async (
		ctx: DeferredCrawlContext,
		target: { fetchUrl: string; resumedAt: string | undefined },
		_permit: PaidLegPermit,
	): Promise<ProxiedFetchAttempt> => {
		const { url } = ctx;
		const result = await proxiedCrawlAndFinalize({
			url: target.fetchUrl,
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
			finalUrl: result.finalUrl ?? target.resumedAt,
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
		return { kind: "committed", candidate: committed.candidate };
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
		const proxiedLeg = renderedThrough === "direct-egress" ? undefined : renderedThrough;
		if (Buffer.byteLength(render.html) > MAX_HTML_BYTES.bytes) {
			if (proxiedLeg !== undefined) deps.reportProxiedRenderAttempt({ outcome: render, readability: "unknown", saveAttemptId: ctx.saveAttemptId, renderedThrough: proxiedLeg });
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
		if (proxiedLeg !== undefined) {
			const readability = committed.via === "deferred-to-event" && committed.readable ? "readable" : "unreadable";
			deps.reportProxiedRenderAttempt({ outcome: render, readability, saveAttemptId: ctx.saveAttemptId, renderedThrough: proxiedLeg });
		}
		if (committed.via !== "unreadable") return { kind: "committed", candidate: committed.candidate };
		const detail = `no readable article after render (${renderedThrough}): ${committed.reason}`;
		if (escalation === "available") return { kind: "unreadable", detail };
		await resolveUnreadable({ url, detail });
		await backOffRefresh(ctx);
		return { kind: "settled" };
	};

	const legDetail = (report: Exclude<RenderLegReport | FetchLegReport, { kind: "blocked" }>): string =>
		report.kind === "skipped" ? `skipped (${report.reason})` : report.kind === "no-body" ? report.outcome : report.detail;

	const settleWithoutBody = async (rendered: Unrendered, ctx: DeferredCrawlContext, receiveCount: number): Promise<CrawlTermination> => {
		const { url } = ctx;
		if (ctx.candidates !== undefined) return publishArchiveComparison({ ...ctx, candidates: ctx.candidates });
		const { direct, residential, webUnlockerFetch, webUnlockerRender } = rendered;
		if (webUnlockerRender.kind === "blocked") return resolveBlocked({ url, httpStatus: webUnlockerRender.httpStatus });
		if (residential.kind === "blocked") return resolveBlocked({ url, httpStatus: residential.httpStatus });
		if (direct.kind === "blocked") return resolveBlocked({ url, httpStatus: direct.httpStatus });
		if (webUnlockerRender.kind === "skipped" && webUnlockerRender.reason === "deferred") {
			logParseError({ url, reason: "crawl-blocked: paid render legs deferred" });
			await emitTier1FailureOutcome({ url });
			await transitionAndPersist(markCrawlBlocked, { url, input: { reason: { kind: "blocked", cause: "edge-block" } } });
			return { via: "committed-in-process" };
		}
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
		await transitionAndPersist(markCrawlExhausted, {
			url,
			input: { reason: { kind: "fetch-failed", detail, httpStatus: httpStatus?.kind === "failed" ? httpStatus.httpStatus : undefined }, receiveCount },
		});
		return { via: "committed-in-process" };
	};

	const resolveLadder = async (rendered: RenderLadderResult, ctx: DeferredCrawlContext, receiveCount: number): Promise<void> => {
		const { url } = ctx;
		if (rendered.kind === "settled") {
			logger.info(`${logPrefix} ladder settled`, { url, settledThrough: rendered.settledThrough, residentialSkipped: rendered.residentialSkipped });
			return;
		}
		if (rendered.kind === "in-flight") {
			logger.info(`${logPrefix} leg in flight under another message`, { url, leg: rendered.leg });
			return;
		}
		if (rendered.kind === "recorded") {
			const candidate = RecordedCandidateSchema.parse(JSON.parse(rendered.outcome));
			logger.info(`${logPrefix} replaying a settled render leg`, { url, leg: rendered.leg });
			await publishArchiveComparison({ ...ctx, candidates: [...(ctx.candidates ?? []), candidate] });
			return;
		}
		if (rendered.kind === "deferred") {
			logger.info(`${logPrefix} paid render legs deferred until a reader asks`, { url, awaiting: rendered.awaiting, direct: rendered.direct });
			if (ctx.candidates !== undefined) {
				await publishArchiveComparison({ ...ctx, candidates: ctx.candidates });
				return;
			}
			await transitionAndPersist(markCrawlAwaitingReader, { url, input: { deferredLeg: rendered.awaiting } });
			return;
		}
		if (rendered.kind === "budget-exhausted") {
			logger.warn(`${logPrefix} render-crawl budget exhausted — failing crawl gracefully`, { url, gate: rendered.gate, direct: withoutResourceHosts(rendered.direct) });
			await resolveBudgetExhausted(ctx);
			await backOffRefresh(ctx);
			return;
		}
		const { direct, residential, webUnlockerFetch, webUnlockerRender } = rendered;
		logger.info(`${logPrefix} not rendered on any leg`, {
			url,
			direct: withoutResourceHosts(direct),
			residential: loggedLeg(residential),
			webUnlockerFetch,
			webUnlockerRender: loggedLeg(webUnlockerRender),
		});
		const outOfTime = Object.entries({ residential, webUnlockerFetch, webUnlockerRender })
			.filter(([, report]) => report.kind === "skipped" && report.reason === "time-exhausted")
			.map(([leg]) => leg);
		if (outOfTime.length > 0) logger.warn(`${logPrefix} render ladder ran out of time`, { url, skippedLegs: outOfTime });
		await settleWithoutBody(rendered, ctx, receiveCount);
		await backOffRefresh(ctx);
	};

	return (event, context, callback) =>
		initSqsRecordHandler({
			definition: RenderCrawlCommand,
			logger,
			failure: { message: `${logPrefix} record failed` },
			malformed: { policy: "retry" },
			handle: async (detail, record) => {
				const { url, userId, recrawl, refresh, saveAttemptId, previousBodyHash, unsupportedReason, finalUrl } = detail;
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
				const resumedAt = await resumableTarget({ url, observedUrl: recrawl || refresh ? undefined : finalUrl });
				const fetchUrl = resumedAt ?? identity.originalUrl;
				logger.info(`${logPrefix} processing`, {
					url,
					recrawl: recrawl ? 1 : 0,
					refresh: refresh ? 1 : 0,
					resumedAtObservedPage: resumedAt === undefined ? 0 : 1,
				});
				let budgetConsumed = false;
				const claimLeg = async (leg: RenderMeteredLeg): Promise<RenderLegClaim> => {
					const claim = await deps.claimMeteredLeg({
						url,
						leg,
						inputHash: legInputHash({ url, leg, inputs: [fetchUrl, previousBodyHash ?? ""] }),
						claimId: record.messageId,
						expiresAt: new Date(deps.now().getTime() + RENDER_CRAWL_TIMEOUTS.sqsVisibilitySeconds * 1000).toISOString(),
					});
					if (claim.kind !== "granted") {
						logMeteredLeg(logger, { url, leg, action: REFUSED_CLAIM_ACTION[claim.kind] });
						return claim;
					}
					if (!budgetConsumed) {
						const budget = await deps.consumeRenderCrawlBudget({ messageId: record.messageId });
						if (!budget.allowed) {
							await deps.releaseMeteredLeg({ url, permit: claim.permit });
							return { kind: "budget-exhausted" };
						}
						budgetConsumed = true;
					}
					logMeteredLeg(logger, { url, leg, action: "claimed" });
					return claim;
				};
				const rendered = await runRenderLadder({
					renderPage: async (params) => {
						const outcome = await deps.renderPage(params);
						if (params.egress.kind !== "direct" && outcome.kind !== "rendered") {
							deps.reportProxiedRenderAttempt({ outcome, readability: "unreadable", saveAttemptId, renderedThrough: PROXIED_RENDER_LEG[params.egress.kind] });
						}
						return outcome;
					},
					url: fetchUrl,
					residentialEgress: deps.residentialEgress,
					webUnlockerEgress: () => deps.webUnlockerEgress,
					unsupportedReason,
					commitRender: (render, escalation) => commitRender(render, escalation, ctx),
					fetchThroughWebUnlocker: (permit) => fetchThroughWebUnlocker(ctx, { fetchUrl, resumedAt }, permit),
					claimLeg,
					settleLeg: async ({ permit, candidate }) => {
						await deps.settleMeteredLeg({ url, permit, outcome: JSON.stringify(candidate), settledAt: deps.now().toISOString() });
						logMeteredLeg(logger, { url, leg: permit.leg, action: "settled" });
					},
					releaseLeg: async (permit) => {
						await deps.releaseMeteredLeg({ url, permit });
						logMeteredLeg(logger, { url, leg: permit.leg, action: "released" });
					},
					remainingMilliseconds: () => context.getRemainingTimeInMillis(),
				});
				await resolveLadder(rendered, ctx, record.receiveCount);
			},
		})(event, context, callback);
}
