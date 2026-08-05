import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {
	DEFAULT_DLQ_RETENTION_SECONDS,
	type DeadLetterQueue,
	type HutchSharedDlq,
} from "./hutch-shared-dlq";

export class HutchSqsQueue extends pulumi.ComponentResource {
	public readonly queueArn: aws.sqs.Queue["arn"];
	public readonly queueUrl: aws.sqs.Queue["url"];
	public readonly queueName: aws.sqs.Queue["name"];
	public readonly dlqArn: aws.sqs.Queue["arn"];
	public readonly dlqUrl: aws.sqs.Queue["url"];
	public readonly dlqName: aws.sqs.Queue["name"];
	public readonly ownDlq: DeadLetterQueue | undefined;

	constructor(
		name: string,
		args?: {
			visibilityTimeoutSeconds?: number;
			dlqMaxReceiveCount?: number;
			dlqRetentionSeconds?: number;
			sharedDlq?: HutchSharedDlq;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchSqsQueue", name, {}, opts);

		const visibilityTimeout = args?.visibilityTimeoutSeconds ?? 60;
		const maxReceiveCount = args?.dlqMaxReceiveCount ?? 3;
		const dlqRetention = args?.dlqRetentionSeconds ?? DEFAULT_DLQ_RETENTION_SECONDS;

		const dlq = args?.sharedDlq ?? new aws.sqs.Queue(`${name}-dlq`, {
			name: `${name}-dlq`,
			messageRetentionSeconds: dlqRetention,
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		const queue = new aws.sqs.Queue(`${name}-q`, {
			name: `${name}-q`,
			visibilityTimeoutSeconds: visibilityTimeout,
			redrivePolicy: pulumi.jsonStringify({
				deadLetterTargetArn: dlq.arn,
				maxReceiveCount,
			}),
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.queueArn = queue.arn;
		this.queueUrl = queue.url;
		this.queueName = queue.name;
		this.dlqArn = dlq.arn;
		this.dlqUrl = dlq.url;
		this.dlqName = dlq.name;
		this.ownDlq = args?.sharedDlq === undefined ? dlq : undefined;
		this.registerOutputs();
	}
}
