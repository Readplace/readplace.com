import * as pulumi from "@pulumi/pulumi";
import type { LambdaPolicy } from "./lambda";

export class DynamoDBAccess {
	public readonly policies: LambdaPolicy[];

	constructor(
		name: string,
		args: {
			tables: { arn: pulumi.Input<string>; includeIndexes: boolean }[];
			actions: string[];
		},
	) {
		const allArns = args.tables.map((t) => t.arn);

		const policy = pulumi.all(allArns).apply((resolvedArns) => {
			const resources: string[] = [];
			for (let i = 0; i < args.tables.length; i++) {
				resources.push(resolvedArns[i]);
				if (args.tables[i].includeIndexes) {
					resources.push(`${resolvedArns[i]}/index/*`);
				}
			}
			return JSON.stringify({
				Version: "2012-10-17",
				Statement: [{
					Effect: "Allow",
					Action: args.actions,
					Resource: resources,
				}],
			});
		});

		this.policies = [{ name: `${name}-pol`, policy }];
	}
}
