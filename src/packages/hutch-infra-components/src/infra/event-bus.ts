import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { HutchSQSBackedLambda } from "./hutch-sqs-backed-lambda";

export class HutchEventBus {
	public readonly eventBusName: pulumi.Output<string>;
	public readonly eventBusArn: pulumi.Output<string>;

	private constructor(
		eventBusName: pulumi.Output<string>,
		eventBusArn: pulumi.Output<string>,
	) {
		this.eventBusName = eventBusName;
		this.eventBusArn = eventBusArn;
	}

	static create(name: string, args?: { eventBusName?: string }): HutchEventBus {
		const bus = new aws.cloudwatch.EventBus(`${name}-event-bus`, {
			name: args?.eventBusName,
		});
		return new HutchEventBus(bus.name, bus.arn);
	}

	static fromExisting(args: {
		eventBusName: pulumi.Input<string>;
		eventBusArn: pulumi.Input<string>;
	}): HutchEventBus {
		return new HutchEventBus(
			pulumi.output(args.eventBusName),
			pulumi.output(args.eventBusArn),
		);
	}

	static fromPlatformStack(config: pulumi.Config): HutchEventBus {
		const platformStackName = config.require("platformStack");
		const stack = new pulumi.StackReference(platformStackName);
		const eventBusName = stack.requireOutput("hutchEventBusName").apply(String);
		const eventBusArn = stack.requireOutput("hutchEventBusArn").apply(String);
		return HutchEventBus.fromExisting({ eventBusName, eventBusArn });
	}

	grantPublish(lambda: { name: string; role: aws.iam.Role }): void {
		const resourceName = `${lambda.name}-eventbridge-publish-pol`;
		new aws.iam.RolePolicy(resourceName, {
			name: resourceName,
			role: lambda.role.name,
			policy: pulumi.output(this.eventBusArn).apply((arn) =>
				JSON.stringify({
					Version: "2012-10-17",
					Statement: [{
						Effect: "Allow",
						Action: ["events:PutEvents"],
						Resource: [arn],
					}],
				}),
			),
		});
	}

	subscribe(
		event: { name: string; source: string; detailType: string },
		target: HutchSQSBackedLambda,
		opts?: { name?: string },
	): void {
		const base = opts?.name ?? event.name;
		this.subscribeAll([{ ...event, name: base }], target, { name: base });
	}

	subscribeAll(
		events: ReadonlyArray<{ name: string; source: string; detailType: string }>,
		target: HutchSQSBackedLambda,
		opts: { name: string },
	): void {
		const ruleArns = events.map((event) => {
			const rule = new aws.cloudwatch.EventRule(`${event.name}-rule`, {
				name: `${event.name}-rule`,
				eventBusName: this.eventBusName,
				eventPattern: JSON.stringify({
					source: [event.source],
					"detail-type": [event.detailType],
				}),
			});

			new aws.cloudwatch.EventTarget(`${event.name}-target`, {
				targetId: `${event.name}-target`,
				rule: rule.name,
				eventBusName: this.eventBusName,
				arn: target.queueArn,
				deadLetterConfig: { arn: target.dlqArn },
			});

			return rule.arn;
		});

		new aws.sqs.QueuePolicy(`${opts.name}-queue-policy`, {
			queueUrl: target.queueUrl,
			policy: pulumi
				.all([target.queueArn, pulumi.all(ruleArns)])
				.apply(([queueArn, arns]) => allowRulesToSend(queueArn, arns)),
		});

		new aws.sqs.QueuePolicy(`${opts.name}-dlq-policy`, {
			queueUrl: target.dlqUrl,
			policy: pulumi
				.all([target.dlqArn, pulumi.all(ruleArns)])
				.apply(([dlqArn, arns]) => allowRulesToSend(dlqArn, arns)),
		});
	}
}

function allowRulesToSend(queueArn: string, ruleArns: string[]): string {
	return JSON.stringify({
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Principal: { Service: "events.amazonaws.com" },
				Action: "sqs:SendMessage",
				Resource: queueArn,
				Condition: {
					ArnEquals: {
						"aws:SourceArn": ruleArns.length === 1 ? ruleArns[0] : ruleArns,
					},
				},
			},
		],
	});
}
