import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import type { Lambda } from "./lambda";
import { type AlarmedDeadLetterQueue, DEFAULT_DLQ_RETENTION_SECONDS } from "./shared-dlq";

type StreamEventName = "INSERT" | "MODIFY" | "REMOVE";

export class DynamoDbStreamBackedLambda extends pulumi.ComponentResource {
	public readonly ownDlq: AlarmedDeadLetterQueue;

	constructor(
		name: string,
		args: {
			lambda: Lambda;
			streamArn: pulumi.Input<string>;
			eventNames: readonly [StreamEventName, ...StreamEventName[]];
			alertEmailDLQEntry: string;
			batchSize: number;
			maximumRetryAttempts: number;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchDynamoDbStreamBackedLambda", name, {}, opts);

		const dlq = new aws.sqs.Queue(`${name}-dlq`, {
			name: `${name}-dlq`,
			messageRetentionSeconds: DEFAULT_DLQ_RETENTION_SECONDS,
		}, { parent: this });

		const streamReadPolicy = new aws.iam.RolePolicy(`${name}-stream-read`, {
			name: `${name}-stream-read`,
			role: args.lambda.role.name,
			policy: pulumi.jsonStringify({
				Version: "2012-10-17",
				Statement: [
					{
						Effect: "Allow",
						Action: [
							"dynamodb:GetRecords",
							"dynamodb:GetShardIterator",
							"dynamodb:DescribeStream",
							"dynamodb:ListStreams",
						],
						Resource: [args.streamArn],
					},
					{
						Effect: "Allow",
						Action: ["sqs:SendMessage"],
						Resource: [dlq.arn],
					},
				],
			}),
		}, { parent: this });

		new aws.lambda.EventSourceMapping(`${name}-stream-mapping`, {
			eventSourceArn: args.streamArn,
			functionName: args.lambda.arn,
			startingPosition: "LATEST",
			batchSize: args.batchSize,
			bisectBatchOnFunctionError: true,
			maximumRetryAttempts: args.maximumRetryAttempts,
			functionResponseTypes: ["ReportBatchItemFailures"],
			filterCriteria: {
				filters: [{ pattern: JSON.stringify({ eventName: args.eventNames }) }],
			},
			destinationConfig: {
				onFailure: { destinationArn: dlq.arn },
			},
		}, { parent: this, dependsOn: [streamReadPolicy] });

		const topic = new aws.sns.Topic(`${name}-dlq-topic`, {
			name: `${name}-dlq-topic`,
		}, { parent: this });

		new aws.sns.TopicSubscription(`${name}-dlq-alarm-email`, {
			topic: topic.arn,
			protocol: "email",
			endpoint: args.alertEmailDLQEntry,
		}, { parent: this });

		new aws.cloudwatch.MetricAlarm(`${name}-dlq-alarm`, {
			name: `${name}-dlq-alarm`,
			comparisonOperator: "GreaterThanOrEqualToThreshold",
			evaluationPeriods: 1,
			metricName: "ApproximateNumberOfMessagesVisible",
			namespace: "AWS/SQS",
			period: 300,
			statistic: "Sum",
			threshold: 1,
			alarmDescription: `Message entered ${name} dead letter queue`,
			dimensions: {
				QueueName: dlq.name,
			},
			alarmActions: [topic.arn],
		}, { parent: this });

		this.ownDlq = {
			arn: dlq.arn,
			url: dlq.url,
			name: dlq.name,
			alarmTopicArn: topic.arn,
		};

		this.registerOutputs();
	}
}
