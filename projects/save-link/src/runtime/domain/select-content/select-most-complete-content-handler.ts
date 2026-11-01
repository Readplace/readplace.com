import { TierContentExtractedEvent } from "@packages/hutch-infra-components";
import { initSelectionQueueHandler } from "./select-content-work";

export const initSelectMostCompleteContentHandler = initSelectionQueueHandler({
	tag: "SelectContent",
	feature: "select-most-complete-content",
	toRequest: (detail) => {
		const parsed = TierContentExtractedEvent.detailSchema.parse(detail);
		return { ...parsed, mode: "save" };
	},
});
