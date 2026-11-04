import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { Certificate } from "@packages/infra-components/infra";

export class DomainRegistration extends pulumi.ComponentResource {
	public readonly certificateArn?: pulumi.Output<string>;
	public readonly zoneId?: Promise<string>;
	public readonly domains: string[];
	public readonly primaryDomain?: string;

	constructor(name: string, args: { domains: string[] }, opts?: pulumi.ComponentResourceOptions) {
		super("hutch:infra:DomainRegistration", name, {}, opts);

		this.domains = args.domains;

		if (args.domains.length === 0) {
			this.registerOutputs();
			return;
		}

		const [primaryDomain, ...altDomains] = args.domains;
		this.primaryDomain = primaryDomain;

		const zone = aws.route53.getZone({ name: primaryDomain });
		const zoneId = zone.then((z) => z.zoneId);
		this.zoneId = zoneId;

		const cert = new Certificate(name, {
			primaryDomain,
			altDomains,
			zoneId,
		}, { parent: this });

		this.certificateArn = cert.certificateArn;
		this.registerOutputs();
	}
}
