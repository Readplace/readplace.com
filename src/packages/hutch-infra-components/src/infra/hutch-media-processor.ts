import type { MediaKindName } from "@packages/media-contracts";
import * as pulumi from "@pulumi/pulumi";
import type { HutchEventBus } from "./event-bus";
import { HutchLambda, type LambdaPolicy } from "./hutch-lambda";
import type { HutchSharedDlq } from "./hutch-shared-dlq";
import { HutchSQS } from "./hutch-sqs";
import { HutchSQSBackedLambda } from "./hutch-sqs-backed-lambda";

const MAX_RECEIVE_COUNT = 2;

export class HutchMediaProcessor extends pulumi.ComponentResource {
	public readonly lambda: HutchLambda;
	public readonly queue: HutchSQS;
	public readonly withSqs: HutchSQSBackedLambda;

	constructor(
		name: string,
		args: {
			eventBus: HutchEventBus;
			event: { name: string; source: string; detailType: string };
			kinds: readonly MediaKindName[];
			subscriptionName: string;
			sharedDlq: HutchSharedDlq;
			alertEmailDLQEntry: string;
			lambda: {
				entryPoint: string;
				outputDir: string;
				assetDir: string;
				memorySize: number;
				timeout: number;
				ephemeralStorageSize?: number;
				environment: Record<string, pulumi.Input<string>>;
				policies: LambdaPolicy[];
			};
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchMediaProcessor", name, {}, opts);

		this.lambda = new HutchLambda(name, args.lambda, { parent: this });
		this.queue = new HutchSQS(name, {
			visibilityTimeoutSeconds: 2 * args.lambda.timeout,
			dlqMaxReceiveCount: MAX_RECEIVE_COUNT,
			sharedDlq: args.sharedDlq,
		}, { parent: this });
		this.withSqs = new HutchSQSBackedLambda(name, {
			lambda: this.lambda,
			queue: this.queue,
			alertEmailDLQEntry: args.alertEmailDLQEntry,
			batchSize: 1,
		}, { parent: this });

		args.eventBus.grantPublish(this.lambda);
		args.eventBus.subscribe(args.event, this.withSqs, {
			name: args.subscriptionName,
			detail: { kind: [...args.kinds] },
		});

		this.registerOutputs();
	}
}
