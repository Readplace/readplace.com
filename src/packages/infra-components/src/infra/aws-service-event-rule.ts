import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { allowRulesToSend } from "./event-bus";
import type { DetailFilter } from "./event-pattern";
import { eventPatternFor } from "./event-pattern";
import type { SqsBackedLambda } from "./sqs-backed-lambda";

type RuleTarget = Pick<SqsBackedLambda, "queueArn" | "queueUrl" | "dlqArn" | "ownDlq">;

export const AwsServiceEventRule = {
	create(
		name: string,
		args: {
			event: { source: string; detailType: string };
			detail?: DetailFilter;
			target: RuleTarget;
		},
	): void {
		const rule = new aws.cloudwatch.EventRule(`${name}-rule`, {
			eventPattern: eventPatternFor({
				source: args.event.source,
				detailType: args.event.detailType,
				detail: args.detail,
			}),
		});

		new aws.cloudwatch.EventTarget(`${name}-target`, {
			rule: rule.name,
			arn: args.target.queueArn,
			deadLetterConfig: { arn: args.target.dlqArn },
		});

		new aws.sqs.QueuePolicy(`${name}-queue-policy`, {
			queueUrl: args.target.queueUrl,
			policy: pulumi
				.all([args.target.queueArn, rule.arn])
				.apply(([queueArn, ruleArn]) => allowRulesToSend(queueArn, [ruleArn])),
		});

		const ownDlq = args.target.ownDlq;
		if (ownDlq) {
			new aws.sqs.QueuePolicy(`${name}-dlq-policy`, {
				queueUrl: ownDlq.url,
				policy: pulumi
					.all([ownDlq.arn, rule.arn])
					.apply(([dlqArn, ruleArn]) => allowRulesToSend(dlqArn, [ruleArn])),
			});
		}
	},
};
