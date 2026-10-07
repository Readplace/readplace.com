import { RefreshContentExtractedEvent } from "@packages/hutch-infra-components";
import { initSelectionQueueHandler } from "./select-content-work";

export const initRefreshContentExtractedHandler = initSelectionQueueHandler({
	tag: "RefreshContentExtracted",
	toRequest: (detail) => {
		const parsed = RefreshContentExtractedEvent.detailSchema.parse(detail);
		return { ...parsed, extractedAt: parsed.contentFetchedAt, refresh: parsed, mode: "refresh" };
	},
});
