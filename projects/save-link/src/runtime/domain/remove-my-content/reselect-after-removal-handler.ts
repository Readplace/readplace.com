import { SaveAttemptIdSchema } from "@packages/domain/article";
import { ReselectAfterRemovalEvent } from "@packages/hutch-infra-components";
import { initSelectionQueueHandler } from "../select-content/select-content-work";

export const initReselectAfterRemovalHandler = initSelectionQueueHandler({
	tag: "ReselectAfterRemoval",
	feature: "reselect-after-removal",
	onExhaustion: "mark-crawl-exhausted",
	toRequest: (detail, record) => ({
		url: ReselectAfterRemovalEvent.detailSchema.parse(detail).url,
		saveAttemptId: SaveAttemptIdSchema.parse(record.messageId),
		mode: "save",
	}),
});
