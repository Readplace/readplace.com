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

		const rule = new aws.cloudwatch.EventRule(`${base}-rule`, {
			name: `${base}-rule`,
			eventBusName: this.eventBusName,
			eventPattern: JSON.stringify({
				source: [event.source],
				"detail-type": [event.detailType],
			}),
		});

		new aws.cloudwatch.EventTarget(`${base}-target`, {
			targetId: `${base}-target`,
			rule: rule.name,
			eventBusName: this.eventBusName,
			arn: target.queueArn,
			deadLetterConfig: { arn: target.dlqArn },
		});

		new aws.sqs.QueuePolicy(`${base}-queue-policy`, {
			queueUrl: target.queueUrl,
			policy: pulumi
				.all([target.queueArn, rule.arn])
				.apply(([queueArn, ruleArn]) =>
					JSON.stringify({
						Version: "2012-10-17",
						Statement: [
							{
								Effect: "Allow",
								Principal: { Service: "events.amazonaws.com" },
								Action: "sqs:SendMessage",
								Resource: queueArn,
								Condition: {
									ArnEquals: { "aws:SourceArn": ruleArn },
								},
							},
						],
					}),
				),
		});

		new aws.sqs.QueuePolicy(`${base}-dlq-policy`, {
			queueUrl: target.dlqUrl,
			policy: pulumi
				.all([target.dlqArn, rule.arn])
				.apply(([dlqArn, ruleArn]) =>
					JSON.stringify({
						Version: "2012-10-17",
						Statement: [
							{
								Effect: "Allow",
								Principal: { Service: "events.amazonaws.com" },
								Action: "sqs:SendMessage",
								Resource: dlqArn,
								Condition: {
									ArnEquals: { "aws:SourceArn": ruleArn },
								},
							},
						],
					}),
				),
		});
	}
}
