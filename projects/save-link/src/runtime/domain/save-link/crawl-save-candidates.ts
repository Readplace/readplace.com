import type { SaveAttemptId } from "@packages/domain/article";
import type { CrawlFailureReason, UserId } from "@packages/article-state-types";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import type { CandidateReference } from "../select-content/list-available-tier-sources";
import type { CrawlArchiveCapture } from "./crawl-archive-capture";
import { ClassifiedCrawlError, type SaveLinkWorkOptions, type SaveLinkWorkResult } from "./save-link-work";

export type SaveCandidates = {
	candidates: CandidateReference[];
	liveAttempt: { outcome: "body" | "no-body"; failureReason?: CrawlFailureReason };
};

export type DeferredSaveCandidates = { deferredTo: "simple-crawl-unsupported"; carriedCandidates: number };

function classifiedFailureReason(error: unknown): CrawlFailureReason {
	if (!(error instanceof ClassifiedCrawlError)) throw error;
	return error.crawlFailureReason;
}

export function initCrawlSaveCandidates(deps: {
	crawlArchiveCapture: CrawlArchiveCapture;
	emitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported;
	saveLinkWork: (url: string, options: SaveLinkWorkOptions) => Promise<SaveLinkWorkResult>;
}) {
	return async (params: {
		url: string;
		captureUrl: string;
		saveAttemptId: SaveAttemptId;
		sourceOriginalUrl?: string;
		userId?: UserId;
		recrawl?: boolean;
	}): Promise<SaveCandidates | DeferredSaveCandidates> => {
		const [live, wrapper] = await Promise.allSettled([
			deps.saveLinkWork(params.url, { userId: params.userId, recrawl: params.recrawl, saveAttemptId: params.saveAttemptId, deferUnsupported: true }),
			deps.crawlArchiveCapture(params),
		]);
		if (wrapper.status === "rejected") throw wrapper.reason;
		const failureReason = live.status === "rejected" ? classifiedFailureReason(live.reason) : undefined;
		const liveValue = live.status === "fulfilled" && typeof live.value === "object" ? live.value : undefined;
		const liveCandidate = liveValue !== undefined && "candidate" in liveValue ? liveValue.candidate : undefined;
		const candidates = [...(liveCandidate === undefined ? [] : [liveCandidate]), ...(wrapper.value === undefined ? [] : [wrapper.value])];
		if (liveValue !== undefined && "deferred" in liveValue) {
			await deps.emitSimpleCrawlUnsupported({ url: params.url, unsupportedReason: liveValue.deferred, userId: params.userId, recrawl: params.recrawl, saveAttemptId: params.saveAttemptId, candidates, finalUrl: liveValue.finalUrl });
			return { deferredTo: "simple-crawl-unsupported", carriedCandidates: candidates.length };
		}
		if (failureReason !== undefined) return { candidates, liveAttempt: { outcome: "no-body", failureReason } };
		return { candidates, liveAttempt: { outcome: liveCandidate === undefined ? "no-body" : "body" } };
	};
}
