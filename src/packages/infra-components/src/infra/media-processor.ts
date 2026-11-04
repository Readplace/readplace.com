import type { MediaKindName } from "@packages/media-contracts";
import * as pulumi from "@pulumi/pulumi";
import type { EventBus } from "./event-bus";
import { Lambda, type LambdaPolicy } from "./lambda";
import type { SharedDlq } from "./shared-dlq";
import { Sqs } from "./sqs";
import { SqsBackedLambda } from "./sqs-backed-lambda";

const MAX_RECEIVE_COUNT = 2;

export class MediaProcessor extends pulumi.ComponentResource {
	public readonly lambda: Lambda;
	public readonly queue: Sqs;
	public readonly withSqs: SqsBackedLambda;

	constructor(
		name: string,
		args: {
			eventBus: EventBus;
			event: { name: string; source: string; detailType: string };
			kinds: readonly MediaKindName[];
			subscriptionName: string;
			sharedDlq: SharedDlq;
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

		this.lambda = new Lambda(name, args.lambda, { parent: this });
		this.queue = new Sqs(name, {
			visibilityTimeoutSeconds: 2 * args.lambda.timeout,
			dlqMaxReceiveCount: MAX_RECEIVE_COUNT,
			sharedDlq: args.sharedDlq,
		}, { parent: this });
		this.withSqs = new SqsBackedLambda(name, {
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
