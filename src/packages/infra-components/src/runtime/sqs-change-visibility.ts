import { ChangeMessageVisibilityCommand } from "@aws-sdk/client-sqs";
import type { ChangeVisibility } from "./sqs-record-handler";

export function initSqsChangeVisibility(deps: {
	client: { send: (command: ChangeMessageVisibilityCommand) => Promise<unknown> };
	queueUrl: string;
}): ChangeVisibility {
	const { client, queueUrl } = deps;
	return async ({ receiptHandle, visibilityTimeoutSeconds }) => {
		await client.send(
			new ChangeMessageVisibilityCommand({
				QueueUrl: queueUrl,
				ReceiptHandle: receiptHandle,
				VisibilityTimeout: visibilityTimeoutSeconds,
			}),
		);
	};
}
