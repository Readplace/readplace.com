import * as pulumi from "@pulumi/pulumi";
import assert from "node:assert";
import { randomUUID } from "node:crypto";

interface InvalidationInputs {
	distributionId: string;
	triggerHash: string;
	paths: string[];
}

async function invalidate(inputs: InvalidationInputs): Promise<string> {
	const { CloudFrontClient, CreateInvalidationCommand } = await import("@aws-sdk/client-cloudfront");
	const client = new CloudFrontClient({});
	const result = await client.send(
		new CreateInvalidationCommand({
			DistributionId: inputs.distributionId,
			InvalidationBatch: {
				CallerReference: `pulumi-${Date.now()}-${randomUUID()}`,
				Paths: { Quantity: inputs.paths.length, Items: inputs.paths },
			},
		}),
	);
	assert(result.Invalidation?.Id, "CreateInvalidation did not return an Invalidation.Id");
	return result.Invalidation.Id;
}

const invalidationProvider: pulumi.dynamic.ResourceProvider = {
	async create(inputs: InvalidationInputs) {
		const id = await invalidate(inputs);
		return {
			id,
			outs: { distributionId: inputs.distributionId, triggerHash: inputs.triggerHash, paths: inputs.paths },
		};
	},
	async update(_id: string, _olds: InvalidationInputs, news: InvalidationInputs) {
		await invalidate(news);
		return { outs: { distributionId: news.distributionId, triggerHash: news.triggerHash, paths: news.paths } };
	},
	async diff(_id: string, olds: InvalidationInputs, news: InvalidationInputs) {
		return { changes: olds.triggerHash !== news.triggerHash };
	},
};

export class CloudFrontInvalidation extends pulumi.dynamic.Resource {
	constructor(
		name: string,
		args: {
			distributionId: pulumi.Input<string>;
			triggerHash: pulumi.Input<string>;
			paths: pulumi.Input<pulumi.Input<string>[]>;
		},
		opts?: pulumi.CustomResourceOptions,
	) {
		super(invalidationProvider, name, args, opts);
	}
}
