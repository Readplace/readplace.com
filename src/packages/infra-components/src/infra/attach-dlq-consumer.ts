import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { Lambda } from "./lambda";
import type { AlarmedDeadLetterQueue } from "./shared-dlq";

const UNDRAINED_DEAD_LETTER_AGE_SECONDS = 15 * 60;

export function attachDlqConsumer(
	name: string,
	args: {
		deadLetterQueue: AlarmedDeadLetterQueue;
		lambda: Lambda;
		batchSize: number;
	},
	opts?: { parent?: pulumi.Resource },
): void {
	new aws.iam.RolePolicy(`${name}-sqs-recv`, {
		name: `${name}-sqs-recv`,
		role: args.lambda.role.name,
		policy: pulumi.output(args.deadLetterQueue.arn).apply((arn) =>
			JSON.stringify({
				Version: "2012-10-17",
				Statement: [{
					Effect: "Allow",
					Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
					Resource: [arn],
				}],
			}),
		),
	}, { parent: opts?.parent });

	new aws.lambda.EventSourceMapping(`${name}-mapping`, {
		eventSourceArn: args.deadLetterQueue.arn,
		functionName: args.lambda.arn,
		batchSize: args.batchSize,
		functionResponseTypes: ["ReportBatchItemFailures"],
	}, { parent: opts?.parent });

	new aws.cloudwatch.MetricAlarm(`${name}-drain-alarm`, {
		name: `${name}-drain-alarm`,
		comparisonOperator: "GreaterThanOrEqualToThreshold",
		evaluationPeriods: 1,
		metricName: "ApproximateAgeOfOldestMessage",
		namespace: "AWS/SQS",
		period: 300,
		statistic: "Maximum",
		threshold: UNDRAINED_DEAD_LETTER_AGE_SECONDS,
		treatMissingData: "notBreaching",
		alarmDescription: pulumi.interpolate`A dead letter has stayed in ${args.deadLetterQueue.name} for ${UNDRAINED_DEAD_LETTER_AGE_SECONDS / 60} minutes without its handler clearing it`,
		dimensions: { QueueName: args.deadLetterQueue.name },
		alarmActions: [args.deadLetterQueue.alarmTopicArn],
	}, { parent: opts?.parent });
}
