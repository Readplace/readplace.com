import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import type { HutchS3ReadWrite } from "./hutch-s3-read-write";
import { HutchCertificate } from "./hutch-certificate";

export class HutchS3ContentMediaCDN extends pulumi.ComponentResource {
	public readonly baseUrl: pulumi.Output<string>;

	constructor(
		name: string,
		args: {
			contentBucket: HutchS3ReadWrite;
			customDomain?: { domain: string; zoneId: pulumi.Input<string> };
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchS3ContentMediaCDN", name, {}, opts);

		const logsBucket = new aws.s3.Bucket(`${name}-cdn-logs`, {
			forceDestroy: true,
		}, { parent: this });

		new aws.s3.BucketOwnershipControls(`${name}-cdn-logs-ownership`, {
			bucket: logsBucket.id,
			rule: { objectOwnership: "BucketOwnerPreferred" },
		}, { parent: this });

		const oac = new aws.cloudfront.OriginAccessControl(`${name}-oac`, {
			name: `${name}-oac`,
			originAccessControlOriginType: "s3",
			signingBehavior: "always",
			signingProtocol: "sigv4",
		}, { parent: this });

		let viewerCertificate: aws.types.input.cloudfront.DistributionViewerCertificate;
		let aliases: pulumi.Input<string>[] | undefined;

		if (args.customDomain) {
			const usEast1 = new aws.Provider(
				`${name}-us-east-1`,
				{ region: "us-east-1" },
				{ parent: this },
			);

			const cert = new HutchCertificate(
				name,
				{
					primaryDomain: args.customDomain.domain,
					altDomains: [],
					zoneId: args.customDomain.zoneId,
					provider: usEast1,
				},
				{ parent: this },
			);

			viewerCertificate = {
				acmCertificateArn: cert.certificateArn,
				sslSupportMethod: "sni-only",
				minimumProtocolVersion: "TLSv1.2_2021",
			};
			aliases = [args.customDomain.domain];
		} else {
			viewerCertificate = { cloudfrontDefaultCertificate: true };
		}

		const distribution = new aws.cloudfront.Distribution(`${name}-cdn`, {
			enabled: true,
			aliases,
			origins: [{
				originId: "content-s3",
				domainName: args.contentBucket.bucketRegionalDomainName,
				originAccessControlId: oac.id,
			}],
			defaultCacheBehavior: {
				targetOriginId: "content-s3",
				viewerProtocolPolicy: "redirect-to-https",
				allowedMethods: ["GET", "HEAD"],
				cachedMethods: ["GET", "HEAD"],
				cachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
			},
			restrictions: {
				geoRestriction: { restrictionType: "none" },
			},
			viewerCertificate,
			priceClass: "PriceClass_100",
			loggingConfig: {
				bucket: logsBucket.bucketDomainName,
				prefix: `${name}/`,
			},
		}, { parent: this });

		new aws.s3.BucketPolicy(`${name}-bucket-access`, {
			bucket: args.contentBucket.bucket,
			policy: pulumi.all([args.contentBucket.arn, distribution.arn]).apply(([bucketArn, distArn]) =>
				JSON.stringify({
					Version: "2012-10-17",
					Statement: [{
						Effect: "Allow",
						Principal: { Service: "cloudfront.amazonaws.com" },
						Action: "s3:GetObject",
						Resource: `${bucketArn}/*`,
						Condition: { StringEquals: { "AWS:SourceArn": distArn } },
					}],
				}),
			),
		}, { parent: this });

		if (args.customDomain) {
			new aws.route53.Record(`${name}-record`, {
				zoneId: args.customDomain.zoneId,
				name: args.customDomain.domain,
				type: "A",
				aliases: [
					{
						name: distribution.domainName,
						zoneId: distribution.hostedZoneId,
						evaluateTargetHealth: false,
					},
				],
			}, { parent: this });
			this.baseUrl = pulumi.output(`https://${args.customDomain.domain}`);
		} else {
			this.baseUrl = pulumi.interpolate`https://${distribution.domainName}`;
		}
		this.registerOutputs();
	}
}
