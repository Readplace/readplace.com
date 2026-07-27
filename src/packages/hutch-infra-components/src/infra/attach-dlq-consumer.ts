import * as aws from "@pulumi/aws";
import type * as pulumi from "@pulumi/pulumi";
import type { HutchLambda } from "./hutch-lambda";
import type { HutchSQS } from "./hutch-sqs";

export function attachDlqConsumer(
	name: string,
	args: {
		sourceQueue: HutchSQS;
		lambda: HutchLambda;
		batchSize: number;
	},
	opts?: { parent?: pulumi.Resource },
): void {
	new aws.iam.RolePolicy(`${name}-sqs-recv`, {
		name: `${name}-sqs-recv`,
		role: args.lambda.role.name,
		policy: args.sourceQueue.dlqArn.apply((arn) =>
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
		eventSourceArn: args.sourceQueue.dlqArn,
		functionName: args.lambda.arn,
		batchSize: args.batchSize,
		functionResponseTypes: ["ReportBatchItemFailures"],
	}, { parent: opts?.parent });
}
