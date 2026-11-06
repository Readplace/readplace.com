import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { LinkDequeuedEvent } from "@packages/infra-components";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { ReleasePrivateItem } from "./private-item-release-steps";

export function initMediaReleaseHandler(deps: {
	releasePrivateItem: ReleasePrivateItem;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: LinkDequeuedEvent,
		logger: deps.logger,
		failure: { message: "[media-release] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail, { messageId }) => {
			const outcome = await deps.releasePrivateItem({ url: detail.url, userId: detail.userId });
			deps.logger.info("[media-release] dequeue handled", { messageId, outcome });
		},
	});
}
