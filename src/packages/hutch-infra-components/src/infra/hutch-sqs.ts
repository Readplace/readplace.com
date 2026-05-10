import * as pulumi from "@pulumi/pulumi";
import type { LambdaPolicy } from "./hutch-lambda";
import { HutchSqsQueue } from "./sqs-queue";

export class HutchSQS extends pulumi.ComponentResource {
	public readonly queueArn: HutchSqsQueue["queueArn"];
	public readonly queueUrl: HutchSqsQueue["queueUrl"];
	public readonly dlqArn: HutchSqsQueue["dlqArn"];
	public readonly dlqUrl: HutchSqsQueue["dlqUrl"];
	public readonly dlqName: HutchSqsQueue["dlqName"];
	public readonly policies: LambdaPolicy[];

	constructor(
		name: string,
		args: { visibilityTimeoutSeconds: number; dlqMaxReceiveCount?: number },
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchSQS", name, {}, opts);

		const queue = new HutchSqsQueue(name, {
			visibilityTimeoutSeconds: args.visibilityTimeoutSeconds,
			dlqMaxReceiveCount: args.dlqMaxReceiveCount,
		}, { parent: this });

		this.queueArn = queue.queueArn;
		this.queueUrl = queue.queueUrl;
		this.dlqArn = queue.dlqArn;
		this.dlqUrl = queue.dlqUrl;
		this.dlqName = queue.dlqName;

		this.policies = [
			{
				name: `${name}-sqs-send-pol`,
				policy: pulumi.output(queue.queueArn).apply((arn) =>
					JSON.stringify({
						Version: "2012-10-17",
						Statement: [{
							Effect: "Allow",
							Action: ["sqs:SendMessage"],
							Resource: [arn],
						}],
					}),
				),
			},
		];

		this.registerOutputs();
	}
}
