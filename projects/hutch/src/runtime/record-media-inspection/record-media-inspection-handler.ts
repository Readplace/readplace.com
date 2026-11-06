import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { RecordMediaInspection } from "@packages/domain";
import { MediaInspectedEvent, MediaRejectedEvent } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import { z } from "zod";

const InspectionEnvelope = z.union([
	z
		.object({ "detail-type": z.literal(MediaInspectedEvent.detailType), detail: MediaInspectedEvent.detailSchema })
		.transform(({ detail }) => ({
			uploadId: detail.uploadId,
			inspection: { verdict: "inspected" as const, facts: detail.facts },
		})),
	z
		.object({ "detail-type": z.literal(MediaRejectedEvent.detailType), detail: MediaRejectedEvent.detailSchema })
		.transform(({ detail }) => ({
			uploadId: detail.uploadId,
			inspection: { verdict: "rejected" as const, reason: detail.reason, notice: detail.notice },
		})),
]);

export function initRecordMediaInspectionHandler(deps: {
	recordMediaInspection: RecordMediaInspection;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const params = InspectionEnvelope.parse(JSON.parse(record.body));
				const session = await deps.recordMediaInspection(params);
				deps.logger.info("[record-media-inspection] inspection recorded", {
					messageId: record.messageId,
					uploadId: params.uploadId,
					verdict: params.inspection.verdict,
					session,
				});
			} catch (error) {
				deps.logger.error("[record-media-inspection] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
