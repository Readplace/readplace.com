import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { HutchLambda } from "./hutch-lambda";
import type { AlarmedDeadLetterQueue } from "./hutch-shared-dlq";

export function attachDlqConsumer(
	name: string,
	args: {
		deadLetterQueue: AlarmedDeadLetterQueue;
		lambda: HutchLambda;
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
		metricName: "NumberOfMessagesReceived",
		namespace: "AWS/SQS",
		period: 300,
		statistic: "Sum",
		threshold: 1,
		treatMissingData: "notBreaching",
		alarmDescription: pulumi.interpolate`A dead letter was received from ${args.deadLetterQueue.name}`,
		dimensions: { QueueName: args.deadLetterQueue.name },
		alarmActions: [args.deadLetterQueue.alarmTopicArn],
	}, { parent: opts?.parent });
}
