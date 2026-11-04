import * as pulumi from "@pulumi/pulumi";
import { attachDlqConsumer } from "./attach-dlq-consumer";
import type { EventBus } from "./event-bus";
import { DynamoDBAccess } from "./dynamodb-access";
import { Lambda, type LambdaPolicy } from "./lambda";
import type { AlarmedDeadLetterQueue } from "./shared-dlq";

/**
 * `additionalDynamoActions` and `additionalPolicies`
 * are escape hatches for callers whose transition needs richer access than
 * the default "UpdateItem only". Aggregate-migrated DLQ
 * handlers use them to add `dynamodb:GetItem` (the aggregate's `store.load`
 * reads before it writes).
 */
export class DLQEventHandler<const N extends readonly string[]> extends pulumi.ComponentResource {
	public readonly logGroupName: pulumi.Output<string>;

	constructor(
		name: string,
		args: {
			deadLetterQueue: AlarmedDeadLetterQueue;
			tableArn: pulumi.Input<string>;
			eventBus: EventBus;
			/** Valid range: 1–10 (AWS SQS EventSourceMapping limit for standard queues). */
			batchSize: number;
			environmentNames: N;
			environment: { [K in NoInfer<N>[number]]: pulumi.Input<string> };
			additionalDynamoActions?: readonly string[];
			additionalPolicies?: readonly LambdaPolicy[];
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchDLQEventHandler", name, {}, opts);

		const dynamodb = new DynamoDBAccess(`${name}-dynamodb`, {
			tables: [{ arn: args.tableArn, includeIndexes: false }],
			actions: ["dynamodb:UpdateItem", ...(args.additionalDynamoActions ?? [])],
		});

		const lambda = new Lambda(name, {
			entryPoint: `./src/runtime/${name}.main.ts`,
			outputDir: `.lib/${name}`,
			assetDir: "./src",
			memorySize: 256,
			timeout: 30,
			environmentNames: args.environmentNames,
			environment: args.environment,
			policies: [...dynamodb.policies, ...(args.additionalPolicies ?? [])],
		}, { parent: this });

		args.eventBus.grantPublish(lambda);
		this.logGroupName = lambda.logGroupName;

		attachDlqConsumer(name, {
			deadLetterQueue: args.deadLetterQueue,
			lambda,
			batchSize: args.batchSize,
		}, { parent: this });

		this.registerOutputs();
	}
}
