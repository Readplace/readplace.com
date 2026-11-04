import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export class Certificate extends pulumi.ComponentResource {
	public readonly certificateArn: pulumi.Output<string>;

	constructor(
		name: string,
		args: {
			primaryDomain: string;
			altDomains: string[];
			zoneId: pulumi.Input<string> | Promise<string>;
			provider?: aws.Provider;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchCertificate", name, {}, opts);

		const providerOpts = args.provider ? { provider: args.provider } : {};

		const cert = new aws.acm.Certificate(
			`${name}-cert`,
			{
				domainName: args.primaryDomain,
				subjectAlternativeNames:
					args.altDomains.length > 0 ? args.altDomains : undefined,
				validationMethod: "DNS",
			},
			{ ...providerOpts, parent: this, aliases: [{ parent: pulumi.rootStackResource }] },
		);

		const validationRecords = cert.domainValidationOptions.apply((opts) =>
			opts.map(
				(opt, i) =>
					new aws.route53.Record(`${name}-cert-validation-${i}`, {
						zoneId: args.zoneId,
						name: opt.resourceRecordName,
						type: opt.resourceRecordType,
						records: [opt.resourceRecordValue],
						ttl: 300,
					}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] }),
			),
		);

		const validated = new aws.acm.CertificateValidation(
			`${name}-cert-validated`,
			{
				certificateArn: cert.arn,
				validationRecordFqdns: validationRecords.apply((records) =>
					records.map((r) => r.fqdn),
				),
			},
			{ ...providerOpts, parent: this, aliases: [{ parent: pulumi.rootStackResource }] },
		);

		this.certificateArn = validated.certificateArn;
		this.registerOutputs();
	}
}
