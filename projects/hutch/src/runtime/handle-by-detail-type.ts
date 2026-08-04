import assert from "node:assert";
import type { Handler, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";

type SqsBatchHandler = Handler<SQSEvent, SQSBatchResponse>;

const envelopeSchema = z.object({ "detail-type": z.string() });

export function initHandleByDetailType(deps: {
	routes: Readonly<Record<string, readonly SqsBatchHandler[]>>;
	logger: HutchLogger;
}): SqsBatchHandler {
	const routes = new Map(Object.entries(deps.routes));

	return async (event, context, callback) => {
		const failedMessageIds = new Set<string>();
		const recordsByHandler = new Map<SqsBatchHandler, SQSRecord[]>();

		for (const record of event.Records) {
			try {
				const detailType = envelopeSchema.parse(JSON.parse(record.body))["detail-type"];
				const handlers = routes.get(detailType);
				assert(handlers, `[handle-by-detail-type] no handler routes '${detailType}'`);
				for (const handler of handlers) {
					const records = recordsByHandler.get(handler) ?? [];
					records.push(record);
					recordsByHandler.set(handler, records);
				}
			} catch (error) {
				deps.logger.error("[handle-by-detail-type] record failed", {
					messageId: record.messageId,
					error,
				});
				failedMessageIds.add(record.messageId);
			}
		}

		for (const [handler, records] of recordsByHandler) {
			const result = await handler({ Records: records }, context, callback);
			assert(result, "[handle-by-detail-type] handler resolved without an SQSBatchResponse");
			for (const failure of result.batchItemFailures) {
				failedMessageIds.add(failure.itemIdentifier);
			}
		}

		return {
			batchItemFailures: [...failedMessageIds].map((itemIdentifier) => ({ itemIdentifier })),
		};
	};
}
