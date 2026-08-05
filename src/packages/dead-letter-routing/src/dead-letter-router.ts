import assert from "node:assert";
import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
	SQSRecord,
} from "aws-lambda";

export type DeadLetterRoutes = Readonly<
	Record<string, Handler<SQSEvent, SQSBatchResponse>>
>;

export function initDeadLetterRouter(deps: {
	routes: DeadLetterRoutes;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { routes } = deps;

	return async (event, context, callback): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const [sourceQueueName, records] of groupBySourceQueue(event.Records)) {
			const route = routes[sourceQueueName];
			assert(
				route,
				`No dead-letter route registered for source queue ${sourceQueueName}`,
			);

			const response = await route({ Records: records }, context, callback);
			assert(
				response,
				`Dead-letter route for ${sourceQueueName} returned no batch response`,
			);

			batchItemFailures.push(...response.batchItemFailures);
		}

		return { batchItemFailures };
	};
}

function groupBySourceQueue(
	records: readonly SQSRecord[],
): ReadonlyMap<string, SQSRecord[]> {
	const grouped = new Map<string, SQSRecord[]>();

	for (const record of records) {
		const sourceQueueArn =
			record.attributes.DeadLetterQueueSourceArn ??
			record.messageAttributes.TARGET_ARN?.stringValue;
		assert(
			sourceQueueArn,
			`Dead letter ${record.messageId} names no source queue, so it cannot be routed`,
		);

		const sourceQueueName = sourceQueueArn.slice(
			sourceQueueArn.lastIndexOf(":") + 1,
		);
		const group = grouped.get(sourceQueueName);
		if (group) {
			group.push(record);
			continue;
		}
		grouped.set(sourceQueueName, [record]);
	}

	return grouped;
}
