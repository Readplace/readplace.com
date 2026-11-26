import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {
	DEFAULT_DLQ_RETENTION_SECONDS,
	type DeadLetterQueue,
} from "./shared-dlq";

export type QueueDeadLetterMode =
	| { sharedDlq?: DeadLetterQueue; fifo?: false }
	| { fifo: true; sharedDlq?: undefined };

export class SqsQueue extends pulumi.ComponentResource {
	public readonly queueArn: aws.sqs.Queue["arn"];
	public readonly queueUrl: aws.sqs.Queue["url"];
	public readonly dlqArn: aws.sqs.Queue["arn"];
	public readonly ownDlq: DeadLetterQueue | undefined;

	constructor(
		name: string,
		args?: {
			visibilityTimeoutSeconds?: number;
			dlqMaxReceiveCount?: number;
		} & QueueDeadLetterMode,
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchSqsQueue", name, {}, opts);

		const visibilityTimeout = args?.visibilityTimeoutSeconds ?? 60;
		const maxReceiveCount = args?.dlqMaxReceiveCount ?? 3;
		const fifo = args?.fifo === true;
		const nameSuffix = fifo ? ".fifo" : "";
		const fifoArgs = fifo ? { fifoQueue: true } : {};

		const dlq = args?.sharedDlq ?? new aws.sqs.Queue(`${name}-dlq`, {
			name: `${name}-dlq${nameSuffix}`,
			messageRetentionSeconds: DEFAULT_DLQ_RETENTION_SECONDS,
			...fifoArgs,
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		const queue = new aws.sqs.Queue(`${name}-q`, {
			name: `${name}-q${nameSuffix}`,
			visibilityTimeoutSeconds: visibilityTimeout,
			redrivePolicy: pulumi.jsonStringify({
				deadLetterTargetArn: dlq.arn,
				maxReceiveCount,
			}),
			...fifoArgs,
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.queueArn = queue.arn;
		this.queueUrl = queue.url;
		this.dlqArn = dlq.arn;
		this.ownDlq = args?.sharedDlq === undefined ? dlq : undefined;
		this.registerOutputs();
	}
}
