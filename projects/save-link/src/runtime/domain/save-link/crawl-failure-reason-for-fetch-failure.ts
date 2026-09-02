import type { CrawlFailureReason } from "@packages/article-state-types";
import type { FetchFailureClassification } from "@packages/crawl-article";

export function crawlFailureReasonForFetchFailure(
	failure: FetchFailureClassification | undefined,
): CrawlFailureReason {
	if (failure === undefined) return { kind: "fetch-failed" };
	if (failure.kind === "origin-unreachable") {
		return {
			kind: "origin-unreachable",
			httpStatus: failure.httpStatus,
			code: failure.code,
		};
	}
	return { kind: "fetch-failed", httpStatus: failure.httpStatus };
}
