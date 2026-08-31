import type { CrawlFailureReason } from "@packages/article-state-types";
import { ClassifiedCrawlError } from "./save-link-work";

export function crawlFailureReasonForError(params: {
	error: unknown;
	receiveCount: number;
}): CrawlFailureReason {
	if (params.error instanceof ClassifiedCrawlError) return params.error.crawlFailureReason;
	return { kind: "exhausted-retries", receiveCount: params.receiveCount };
}
