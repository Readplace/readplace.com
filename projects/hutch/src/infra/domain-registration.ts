import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { Certificate } from "@packages/infra-components/infra";

export class DomainRegistration extends pulumi.ComponentResource {
	public readonly certificateArn?: pulumi.Output<string>;
	public readonly zoneId?: Promise<string>;

	constructor(name: string, args: { domain: string | undefined }, opts?: pulumi.ComponentResourceOptions) {
		super("hutch:infra:DomainRegistration", name, {}, opts);

		const { domain } = args;
		if (domain === undefined) {
			this.registerOutputs();
			return;
		}

		const zone = aws.route53.getZone({ name: domain });
		const zoneId = zone.then((z) => z.zoneId);
		this.zoneId = zoneId;

		const cert = new Certificate(name, {
			primaryDomain: domain,
			altDomains: [],
			zoneId,
		}, { parent: this });

		this.certificateArn = cert.certificateArn;
		this.registerOutputs();
	}
}
