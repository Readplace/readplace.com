import * as aws from "@pulumi/aws";
import { HutchCertificate } from "@packages/hutch-infra-components/infra";

export class DomainRedirect {
	constructor(
		name: string,
		args: {
			redirectDomains: string[];
			redirectSubdomains?: Array<{ host: string; zoneName: string }>;
			targetDomain: string;
		},
	) {
		const redirectSubdomains = args.redirectSubdomains ?? [];
		if (args.redirectDomains.length === 0 && redirectSubdomains.length === 0) return;

		const usEast1 = new aws.Provider(`${name}-us-east-1`, {
			region: "us-east-1",
		});

		const createRedirect = ({
			domain,
			zoneId,
		}: { domain: string; zoneId: Promise<string> }): void => {
			const safeName = domain.replace(/\./g, "-");
			const resourcePrefix = `${name}-${safeName}`;

			const cert = new HutchCertificate(resourcePrefix, {
				primaryDomain: domain,
				altDomains: [],
				zoneId,
				provider: usEast1,
			});

			const bucket = new aws.s3.BucketV2(`${resourcePrefix}-bucket`, {
				bucket: domain,
			});

			const websiteConfig = new aws.s3.BucketWebsiteConfigurationV2(
				`${resourcePrefix}-website`,
				{
					bucket: bucket.id,
					redirectAllRequestsTo: {
						hostName: args.targetDomain,
						protocol: "https",
					},
				},
			);

			const distribution = new aws.cloudfront.Distribution(
				`${resourcePrefix}-cdn`,
				{
					enabled: true,
					aliases: [domain],
					origins: [
						{
							originId: "s3-website",
							domainName: websiteConfig.websiteEndpoint,
							customOriginConfig: {
								httpPort: 80,
								httpsPort: 443,
								originProtocolPolicy: "http-only",
								originSslProtocols: ["TLSv1.2"],
							},
						},
					],
					defaultCacheBehavior: {
						targetOriginId: "s3-website",
						viewerProtocolPolicy: "redirect-to-https",
						allowedMethods: ["GET", "HEAD"],
						cachedMethods: ["GET", "HEAD"],
						compress: true,
						cachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
					},
					restrictions: {
						geoRestriction: {
							restrictionType: "none",
						},
					},
					viewerCertificate: {
						acmCertificateArn: cert.certificateArn,
						sslSupportMethod: "sni-only",
						minimumProtocolVersion: "TLSv1.2_2021",
					},
					priceClass: "PriceClass_100",
				},
			);

			new aws.route53.Record(`${resourcePrefix}-record`, {
				zoneId,
				name: domain,
				type: "A",
				aliases: [
					{
						name: distribution.domainName,
						zoneId: distribution.hostedZoneId,
						evaluateTargetHealth: false,
					},
				],
			});
		};

		for (const domain of args.redirectDomains) {
			const zoneId = aws.route53.getZone({ name: domain }).then((z) => z.zoneId);
			createRedirect({ domain, zoneId });
		}

		for (const { host, zoneName } of redirectSubdomains) {
			const zoneId = aws.route53.getZone({ name: zoneName }).then((z) => z.zoneId);
			createRedirect({ domain: host, zoneId });
		}
	}
}
