import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { UserIdSchema } from "@packages/domain/user";
import { LinkDequeuedEvent } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import { z } from "zod";
import type { ReleasePrivateItem } from "./private-item-release-steps";

export function initMediaReleaseHandler(deps: {
	releasePrivateItem: ReleasePrivateItem;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = LinkDequeuedEvent.detailSchema.parse(envelope.detail);
				const outcome = await deps.releasePrivateItem({ url: detail.url, userId: UserIdSchema.parse(detail.userId) });
				deps.logger.info("[media-release] dequeue handled", { messageId: record.messageId, outcome });
			} catch (error) {
				deps.logger.error("[media-release] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
