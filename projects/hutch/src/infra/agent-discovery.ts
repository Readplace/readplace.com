import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

/**
 * DNS for AI Discovery (DNS-AID) entry-point records, published in the domain's
 * Route 53 hosted zone so a validating agent can discover Readplace's agent
 * surface straight from DNS — no prior knowledge of any well-known path.
 *
 * 1. ServiceMode SVCB at `_index._agents.<domain>` is the organizational entry
 *    point of draft-mozleywilliams-dnsop-dnsaid: priority 1 (ServiceMode), a
 *    TargetName with no underscores so the host's public x.509 cert applies, and
 *    `alpn` advertising the HTTP versions the registry host speaks (RFC 9460).
 * 2. TXT at the same name carries a machine-readable pointer to the registry the
 *    SVCB target serves — Readplace's RFC 9727 `/.well-known/api-catalog` linkset,
 *    which already enumerates the docs, sign-in, and health endpoints.
 */
export class AgentDiscovery extends pulumi.ComponentResource {
	constructor(
		name: string,
		args: {
			domain: string;
			zoneId: pulumi.Input<string>;
			registryHost: string;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:AgentDiscovery", name, {}, opts);

		const entryPoint = `_index._agents.${args.domain}`;

		new aws.route53.Record(
			`${name}-index-svcb`,
			{
				zoneId: args.zoneId,
				name: entryPoint,
				type: "SVCB",
				ttl: 300,
				records: [`1 ${args.registryHost}. alpn="h2,h3" port=443`],
			},
			{ parent: this },
		);

		new aws.route53.Record(
			`${name}-index-txt`,
			{
				zoneId: args.zoneId,
				name: entryPoint,
				type: "TXT",
				ttl: 300,
				records: [`registry=https://${args.registryHost}/.well-known/api-catalog`],
			},
			{ parent: this },
		);

		this.registerOutputs();
	}
}
