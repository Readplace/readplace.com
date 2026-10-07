import { RecrawlContentExtractedEvent } from "@packages/hutch-infra-components";
import { initSelectionQueueHandler } from "./select-content-work";

export const initRecrawlContentExtractedHandler = initSelectionQueueHandler({
	tag: "RecrawlContentExtracted",
	toRequest: (detail) => {
		const parsed = RecrawlContentExtractedEvent.detailSchema.parse(detail);
		return { ...parsed, mode: "recrawl" };
	},
});
