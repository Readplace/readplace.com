import type { SaveAttemptId } from "@packages/domain/article";
import type { Logger } from "@packages/logger";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { TransitionAndPersist } from "@packages/domain/article-aggregate";
import type { LogCrawlOutcome, LogParseError } from "@packages/infra-components";
import type { CrawlAndFinalizeArticle } from "@packages/finalize-article";
import type { PutTierSource } from "@packages/tier-source";
import type { VerifyWrapperSource } from "@packages/save-article";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { ReadTierSnapshot } from "../crawl-article-state/read-tier-snapshot";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import type { UpdateFetchTimestamp } from "./update-fetch-timestamp-handler";
import type { AdoptCanonicalIdentity } from "./adopt-canonical-identity";
import { initSaveLinkWork } from "./save-link-work";
import { initCrawlArchiveCapture } from "./crawl-archive-capture";
import { initCrawlSaveCandidates, type SaveCandidates } from "./crawl-save-candidates";

export type RunCrawlFromTier1Deps = {
	crawlAndFinalizeArticle: CrawlAndFinalizeArticle;
	emitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported;
	putTierSource: PutTierSource;
	updateFetchTimestamp: UpdateFetchTimestamp;
	transitionAndPersist: TransitionAndPersist;
	markCrawlStage: MarkCrawlStage;
	adoptCanonicalIdentity: AdoptCanonicalIdentity;
	isSiteRuleUrl: (url: string) => boolean;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: Logger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	readTierSnapshot: ReadTierSnapshot;
	resolveOriginalUrl: (url: string) => Promise<string>;
	verifyWrapperSource: VerifyWrapperSource;
	findContentSourceUrl: (url: string) => Promise<string | undefined>;
};

export type RunCrawlFromTier1 = (params: {
	url: string;
	saveAttemptId: SaveAttemptId;
	recrawl: boolean;
	sourceOriginalUrl: string | undefined;
}) => Promise<SaveCandidates | undefined>;

export function initRunCrawlFromTier1(deps: RunCrawlFromTier1Deps & { logPrefix: string }): RunCrawlFromTier1 {
	const { saveLinkWork } = initSaveLinkWork({
		crawlAndFinalizeArticle: deps.crawlAndFinalizeArticle,
		emitSimpleCrawlUnsupported: deps.emitSimpleCrawlUnsupported,
		putTierSource: deps.putTierSource,
		publishEvent: deps.publishEvent,
		updateFetchTimestamp: deps.updateFetchTimestamp,
		transitionAndPersist: deps.transitionAndPersist,
		markCrawlStage: deps.markCrawlStage,
		adoptCanonicalIdentity: deps.adoptCanonicalIdentity,
		isSiteRuleUrl: deps.isSiteRuleUrl,
		now: deps.now,
		logger: deps.logger,
		logParseError: deps.logParseError,
		logCrawlOutcome: deps.logCrawlOutcome,
		readTierSnapshot: deps.readTierSnapshot,
		logPrefix: deps.logPrefix,
		resolveOriginalUrl: deps.resolveOriginalUrl,
	});

	const crawlArchiveCapture = initCrawlArchiveCapture({
		crawlAndFinalizeArticle: deps.crawlAndFinalizeArticle,
		putTierSource: deps.putTierSource,
		readTierSnapshot: deps.readTierSnapshot,
		logCrawlOutcome: deps.logCrawlOutcome,
		publishEvent: deps.publishEvent,
		logger: deps.logger,
		now: deps.now,
		verifyWrapperSource: deps.verifyWrapperSource,
	});

	const crawlSaveCandidates = initCrawlSaveCandidates({ crawlArchiveCapture, saveLinkWork, emitSimpleCrawlUnsupported: deps.emitSimpleCrawlUnsupported });

	return async ({ url, saveAttemptId, recrawl, sourceOriginalUrl }) => {
		const captureUrl = await deps.findContentSourceUrl(url);
		if (captureUrl !== undefined) {
			const result = await crawlSaveCandidates({ url, captureUrl, saveAttemptId, recrawl, sourceOriginalUrl });
			return "deferredTo" in result ? undefined : result;
		}
		const result = await saveLinkWork(url, { recrawl, saveAttemptId });
		if (typeof result !== "object" || "deferred" in result) return undefined;
		return { candidates: [result.candidate], liveAttempt: { outcome: "body" } };
	};
}
