import type { SaveAttemptId } from "@packages/domain/article";
import type { CrawlFailureReason } from "@packages/article-state-types";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import type { CandidateReference } from "../select-content/list-available-tier-sources";
import type { LiveAttempt } from "../select-content/prepare-content-selection";
import type { CrawlArchiveCapture } from "./crawl-archive-capture";
import { ClassifiedCrawlError, type SaveLinkWorkOptions, type SaveLinkWorkResult } from "./save-link-work";

export type SaveCandidates = {
	candidates: CandidateReference[];
	liveAttempt: LiveAttempt;
};

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
		userId?: string;
		recrawl?: boolean;
	}): Promise<SaveCandidates> => {
		const [live, wrapper] = await Promise.allSettled([
			deps.saveLinkWork(params.url, { userId: params.userId, recrawl: params.recrawl, saveAttemptId: params.saveAttemptId, deferUnsupported: true }),
			deps.crawlArchiveCapture(params),
		]);
		if (wrapper.status === "rejected") throw wrapper.reason;
		const failureReason = live.status === "rejected" ? classifiedFailureReason(live.reason) : undefined;
		const liveCandidate = live.status === "fulfilled" && typeof live.value === "object" ? live.value.candidate : undefined;
		const candidates = [...(liveCandidate === undefined ? [] : [liveCandidate]), ...(wrapper.value === undefined ? [] : [wrapper.value])];
		const deferred = live.status === "fulfilled" && live.value === "tier-1-deferred";
		if (deferred) await deps.emitSimpleCrawlUnsupported({ url: params.url, userId: params.userId, recrawl: params.recrawl, saveAttemptId: params.saveAttemptId, candidates });
		if (failureReason !== undefined) return { candidates, liveAttempt: { outcome: "no-body", failureReason } };
		return {
			candidates,
			liveAttempt: { outcome: deferred ? "deferred" : liveCandidate === undefined ? "no-body" : "body" },
		};
	};
}
