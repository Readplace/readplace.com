import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

/**
 * Publishes DNS for AI Discovery (DNS-AID) records so an agent can find
 * Readplace's agent surface straight from DNS, and signs the zone with DNSSEC
 * so a validating resolver returns authenticated answers.
 *
 * Two ServiceMode SVCB records are published under the `_agents` namespace:
 *  - `_index._agents.<domain>` — the discovery entry point. It points at the
 *    apex, which already serves the `/.well-known/agent-skills` index, the
 *    OAuth metadata, and `llms.txt`.
 *  - `_mcp._agents.<domain>`   — the MCP endpoint, whose Server Card and
 *    Streamable HTTP transport live at `/.well-known/mcp/server-card.json` and
 *    `/mcp` on the apex.
 *
 * Both target the apex over HTTP/2 on 443 with only the IANA-registered SvcParams
 * (`alpn`, `port`) so Route 53 accepts the RDATA; the protocol-specific paths are
 * resolved from the well-known documents the records lead an agent to.
 */
export class AgentDiscoveryDns extends pulumi.ComponentResource {
	/** The DS record to hand the domain's registrar to complete the DNSSEC
	 * chain of trust. Signing is enabled on the zone here, but a resolver only
	 * validates once this DS is published in the parent zone — a deliberate,
	 * out-of-band step because a wrong DS breaks resolution for the whole
	 * domain. */
	public readonly dsRecord: pulumi.Output<string>;

	constructor(
		name: string,
		args: { domain: string; zoneId: pulumi.Input<string> },
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:AgentDiscoveryDns", name, {}, opts);

		// SVCB ServiceMode RDATA in Route 53's presentation format
		// (`SvcPriority TargetName SvcParams`). Only IANA-registered SvcParamKeys
		// are used — Route 53 rejects the experimental `keyNNNNN` form — so the
		// DNS-AID-specific paths live in the well-known documents these records
		// point an agent to, not in the RDATA.
		const serviceValue = `1 ${args.domain} alpn="h2" port=443`;

		new aws.route53.Record(
			`${name}-agents-index`,
			{
				zoneId: args.zoneId,
				name: `_index._agents.${args.domain}`,
				type: "SVCB",
				ttl: 3600,
				records: [serviceValue],
			},
			{ parent: this },
		);

		new aws.route53.Record(
			`${name}-agents-mcp`,
			{
				zoneId: args.zoneId,
				name: `_mcp._agents.${args.domain}`,
				type: "SVCB",
				ttl: 3600,
				records: [serviceValue],
			},
			{ parent: this },
		);

		// Route 53 DNSSEC requires the key-signing KMS key to be an asymmetric
		// ECC_NIST_P256 SIGN_VERIFY key in us-east-1, regardless of where the rest
		// of the stack runs.
		const usEast1 = new aws.Provider(
			`${name}-useast1`,
			{ region: "us-east-1" },
			{ parent: this },
		);

		const accountId = pulumi
			.output(aws.getCallerIdentity({}))
			.apply((identity) => identity.accountId);

		// A custom key policy replaces the default, so it must re-grant the
		// account root (or the deploy role loses access) alongside the Route 53
		// DNSSEC service principal that signs and creates grants.
		const keyPolicy = accountId.apply((id) =>
			JSON.stringify({
				Version: "2012-10-17",
				Statement: [
					{
						Sid: "Enable IAM User Permissions",
						Effect: "Allow",
						Principal: { AWS: `arn:aws:iam::${id}:root` },
						Action: "kms:*",
						Resource: "*",
					},
					{
						Sid: "AllowRoute53DnssecService",
						Effect: "Allow",
						Principal: { Service: "dnssec-route53.amazonaws.com" },
						Action: ["kms:DescribeKey", "kms:GetPublicKey", "kms:Sign"],
						Resource: "*",
					},
					{
						Sid: "AllowRoute53DnssecCreateGrant",
						Effect: "Allow",
						Principal: { Service: "dnssec-route53.amazonaws.com" },
						Action: "kms:CreateGrant",
						Resource: "*",
						Condition: { Bool: { "kms:GrantIsForAWSResource": "true" } },
					},
				],
			}),
		);

		const signingKey = new aws.kms.Key(
			`${name}-dnssec-kms`,
			{
				customerMasterKeySpec: "ECC_NIST_P256",
				keyUsage: "SIGN_VERIFY",
				deletionWindowInDays: 7,
				policy: keyPolicy,
			},
			{ parent: this, provider: usEast1 },
		);

		const keySigningKey = new aws.route53.KeySigningKey(
			`${name}-ksk`,
			{
				hostedZoneId: args.zoneId,
				keyManagementServiceArn: signingKey.arn,
				name: "readplace_agents_ksk",
			},
			{ parent: this },
		);

		new aws.route53.HostedZoneDnsSec(
			`${name}-dnssec`,
			{
				hostedZoneId: args.zoneId,
				signingStatus: "SIGNING",
			},
			{ parent: this, dependsOn: [keySigningKey] },
		);

		this.dsRecord = keySigningKey.dsRecord;
		this.registerOutputs({ dsRecord: this.dsRecord });
	}
}
