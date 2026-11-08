import { randomUUID } from "node:crypto";
import type { SendMessageCommandInput } from "@aws-sdk/client-sqs";

type FifoCommandMessage<D> = {
	messageGroupId: (detail: D) => string;
};

export type CommandQueueDelivery<D> =
	| { delaySeconds?: number; fifo?: undefined }
	| { fifo: FifoCommandMessage<D>; delaySeconds?: undefined };

export function buildCommandMessage<D>(params: {
	queueUrl: string;
	detail: D;
	delivery: CommandQueueDelivery<D>;
}): SendMessageCommandInput {
	const { queueUrl, detail, delivery } = params;
	const message = { QueueUrl: queueUrl, MessageBody: JSON.stringify({ detail }) };
	if (delivery.fifo === undefined) return { ...message, DelaySeconds: delivery.delaySeconds };
	return {
		...message,
		MessageGroupId: delivery.fifo.messageGroupId(detail),
		MessageDeduplicationId: randomUUID(),
	};
}
