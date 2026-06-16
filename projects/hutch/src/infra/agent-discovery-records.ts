import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { buildDnsAidRecords } from "../runtime/web/dns-aid";

export class AgentDiscoveryRecords extends pulumi.ComponentResource {
	constructor(
		name: string,
		args: {
			domains: ReadonlyArray<{
				domain: string;
				zoneId: pulumi.Input<string> | Promise<string>;
			}>;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:AgentDiscoveryRecords", name, {}, opts);

		for (const { domain, zoneId } of args.domains) {
			for (const record of buildDnsAidRecords(domain)) {
				const safeName = record.name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
				new aws.route53.Record(
					`${name}-${safeName}`,
					{
						zoneId,
						name: record.name,
						type: record.type,
						records: [record.value],
						ttl: record.ttlSeconds,
					},
					{ parent: this },
				);
			}
		}

		this.registerOutputs();
	}
}
