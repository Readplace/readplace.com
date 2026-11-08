import * as pulumi from "@pulumi/pulumi";
import type { LambdaPolicy } from "./lambda";
import { type QueueDeadLetterMode, SqsQueue } from "./sqs-queue";

export class Sqs extends pulumi.ComponentResource {
	public readonly queueArn: SqsQueue["queueArn"];
	public readonly queueUrl: SqsQueue["queueUrl"];
	public readonly dlqArn: SqsQueue["dlqArn"];
	public readonly dlqUrl: SqsQueue["dlqUrl"];
	public readonly dlqName: SqsQueue["dlqName"];
	public readonly ownDlq: SqsQueue["ownDlq"];
	public readonly policies: LambdaPolicy[];

	constructor(
		name: string,
		args: {
			visibilityTimeoutSeconds: number;
			dlqMaxReceiveCount?: number;
		} & QueueDeadLetterMode,
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchSQS", name, {}, opts);

		const queue = new SqsQueue(name, {
			visibilityTimeoutSeconds: args.visibilityTimeoutSeconds,
			dlqMaxReceiveCount: args.dlqMaxReceiveCount,
			...(args.fifo === true ? { fifo: true } : { sharedDlq: args.sharedDlq }),
		}, { parent: this });

		this.queueArn = queue.queueArn;
		this.queueUrl = queue.queueUrl;
		this.dlqArn = queue.dlqArn;
		this.dlqUrl = queue.dlqUrl;
		this.dlqName = queue.dlqName;
		this.ownDlq = queue.ownDlq;

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
