import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export const DEFAULT_DLQ_RETENTION_SECONDS = 1209600;

export interface DeadLetterQueue {
	readonly arn: aws.sqs.Queue["arn"];
	readonly url: aws.sqs.Queue["url"];
	readonly name: aws.sqs.Queue["name"];
}

export class HutchSharedDlq extends pulumi.ComponentResource {
	public readonly arn: aws.sqs.Queue["arn"];
	public readonly url: aws.sqs.Queue["url"];
	public readonly name: aws.sqs.Queue["name"];

	constructor(
		name: string,
		args: {
			alertEmailDLQEntry: string;
			retentionSeconds?: number;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchSharedDlq", name, {}, opts);

		const queue = new aws.sqs.Queue(`${name}-dlq`, {
			name: `${name}-dlq`,
			messageRetentionSeconds: args.retentionSeconds ?? DEFAULT_DLQ_RETENTION_SECONDS,
		}, { parent: this });

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
				QueueName: queue.name,
			},
			alarmActions: [topic.arn],
		}, { parent: this });

		const accountId = pulumi.output(
			aws.getCallerIdentity({}, { parent: this }),
		).accountId;

		new aws.sqs.QueuePolicy(`${name}-dlq-policy`, {
			queueUrl: queue.url,
			policy: pulumi.all([queue.arn, accountId]).apply(([queueArn, account]) =>
				JSON.stringify({
					Version: "2012-10-17",
					Statement: [{
						Effect: "Allow",
						Principal: { Service: "events.amazonaws.com" },
						Action: "sqs:SendMessage",
						Resource: queueArn,
						Condition: {
							StringEquals: { "aws:SourceAccount": account },
						},
					}],
				}),
			),
		}, { parent: this });

		this.arn = queue.arn;
		this.url = queue.url;
		this.name = queue.name;
		this.registerOutputs();
	}
}
