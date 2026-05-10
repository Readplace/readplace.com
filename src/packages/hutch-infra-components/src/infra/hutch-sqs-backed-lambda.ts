import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import type { HutchLambda } from "./hutch-lambda";
import type { HutchSQS } from "./hutch-sqs";

export class HutchSQSBackedLambda extends pulumi.ComponentResource {
	public readonly queueArn: HutchSQS["queueArn"];
	public readonly queueUrl: HutchSQS["queueUrl"];

	constructor(
		name: string,
		args: {
			lambda: HutchLambda;
			queue: HutchSQS;
			alertEmailDLQEntry: string;
			/**
			 * Maximum number of SQS records the EventSourceMapping will hand to a
			 * single Lambda invocation. Required so every callsite makes the
			 * choice explicit — set to 1 today on the handlers that process one
			 * record at a time, raise it later without touching the handler
			 * because every handler returns SQSBatchResponse and the mapping
			 * always wires ReportBatchItemFailures.
			 */
			batchSize: number;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchSQSBackedLambda", name, {}, opts);

		this.queueArn = args.queue.queueArn;
		this.queueUrl = args.queue.queueUrl;
		new aws.iam.RolePolicy(`${name}-sqs-recv`, {
			name: `${name}-sqs-recv`,
			role: args.lambda.role.name,
			policy: args.queue.queueArn.apply((arn) =>
				JSON.stringify({
					Version: "2012-10-17",
					Statement: [{
						Effect: "Allow",
						Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
						Resource: [arn],
					}],
				}),
			),
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		new aws.lambda.EventSourceMapping(`${name}-sqs-mapping`, {
			eventSourceArn: args.queue.queueArn,
			functionName: args.lambda.arn,
			batchSize: args.batchSize,
			functionResponseTypes: ["ReportBatchItemFailures"],
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		const topic = new aws.sns.Topic(`${name}-dlq-topic`, {
			name: `${name}-dlq-topic`,
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		new aws.sns.TopicSubscription(`${name}-dlq-alarm-email`, {
			topic: topic.arn,
			protocol: "email",
			endpoint: args.alertEmailDLQEntry,
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

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
				QueueName: args.queue.dlqName,
			},
			alarmActions: [topic.arn],
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.registerOutputs();
	}
}
