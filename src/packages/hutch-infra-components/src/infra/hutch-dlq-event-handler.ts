import * as pulumi from "@pulumi/pulumi";
import { attachDlqConsumer } from "./attach-dlq-consumer";
import type { HutchEventBus } from "./event-bus";
import { HutchDynamoDBAccess } from "./hutch-dynamodb-access";
import { HutchLambda, type LambdaPolicy } from "./hutch-lambda";

/**
 * `additionalDynamoActions`, `additionalEnvironment`, and `additionalPolicies`
 * are escape hatches for callers whose transition needs richer access than
 * the default "UpdateItem only, no extra env". Aggregate-migrated DLQ
 * handlers use them to add `dynamodb:GetItem` (the aggregate's `store.load`
 * reads before it writes) and to pass `GENERATE_SUMMARY_QUEUE_URL` even
 * when the current transition does not dispatch a summary command — the
 * aggregate effect dispatcher is wired uniformly so a future transition
 * change at the same callsite cannot regress without re-wiring infra.
 */
export class HutchDLQEventHandler extends pulumi.ComponentResource {
	constructor(
		name: string,
		args: {
			deadLetterQueueArn: pulumi.Input<string>;
			tableArn: pulumi.Input<string>;
			tableName: pulumi.Input<string>;
			eventBus: HutchEventBus;
			/** Valid range: 1–10 (AWS SQS EventSourceMapping limit for standard queues). */
			batchSize: number;
			additionalDynamoActions?: readonly string[];
			additionalEnvironment?: Record<string, pulumi.Input<string>>;
			additionalPolicies?: readonly LambdaPolicy[];
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchDLQEventHandler", name, {}, opts);

		const dynamodb = new HutchDynamoDBAccess(`${name}-dynamodb`, {
			tables: [{ arn: args.tableArn, includeIndexes: false }],
			actions: ["dynamodb:UpdateItem", ...(args.additionalDynamoActions ?? [])],
		});

		const lambda = new HutchLambda(name, {
			entryPoint: `./src/runtime/${name}.main.ts`,
			outputDir: `.lib/${name}`,
			assetDir: "./src",
			memorySize: 256,
			timeout: 30,
			environment: {
				DYNAMODB_ARTICLES_TABLE: args.tableName,
				EVENT_BUS_NAME: args.eventBus.eventBusName,
				...args.additionalEnvironment,
			},
			policies: [...dynamodb.policies, ...(args.additionalPolicies ?? [])],
		}, { parent: this });

		args.eventBus.grantPublish(lambda);

		attachDlqConsumer(name, {
			deadLetterQueueArn: args.deadLetterQueueArn,
			lambda,
			batchSize: args.batchSize,
		}, { parent: this });

		this.registerOutputs();
	}
}
