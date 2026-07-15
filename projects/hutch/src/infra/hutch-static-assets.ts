import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import assert from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import * as path from "node:path";
import { HutchCertificate, HutchS3PublicRead } from "@packages/hutch-infra-components/infra";

export interface StaticDomainEntry {
	domain: string;
	zoneId?: pulumi.Input<string>;
}

const CONTENT_TYPES: Record<string, string> = {
	".png": "image/png",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".webmanifest": "application/manifest+json",
	".xml": "application/xml",
	".mp4": "video/mp4",
	".opus": "audio/ogg",
};

function contentTypeFor(key: string): string {
	const ext = path.posix.extname(key).toLowerCase();
	const ct = CONTENT_TYPES[ext];
	assert(ct, `HutchStaticAssets: no content-type mapping for ${ext} (file: ${key})`);
	return ct;
}

function walkStaticAssets(rootAbs: string): Array<{ key: string; absolutePath: string }> {
	const entries = readdirSync(rootAbs, { recursive: true, withFileTypes: true });
	const files: Array<{ key: string; absolutePath: string }> = [];
	for (const entry of entries) {
		if (entry.isDirectory()) continue;
		const absolutePath = path.join(entry.parentPath, entry.name);
		const relative = path.relative(rootAbs, absolutePath);
		const key = relative.split(path.sep).join("/");
		files.push({ key, absolutePath });
	}
	files.sort((a, b) => a.key.localeCompare(b.key));
	return files;
}

interface InvalidationInputs {
	distributionId: string;
	triggerHash: string;
}

const invalidationProvider: pulumi.dynamic.ResourceProvider = {
	async create(inputs: InvalidationInputs) {
		const { CloudFrontClient, CreateInvalidationCommand } = await import("@aws-sdk/client-cloudfront");
		const client = new CloudFrontClient({});
		const result = await client.send(
			new CreateInvalidationCommand({
				DistributionId: inputs.distributionId,
				InvalidationBatch: {
					CallerReference: `pulumi-${Date.now()}-${randomUUID()}`,
					Paths: { Quantity: 1, Items: ["/*"] },
				},
			}),
		);
		assert(result.Invalidation?.Id, "CreateInvalidation did not return an Invalidation.Id");
		return {
			id: result.Invalidation.Id,
			outs: { distributionId: inputs.distributionId, triggerHash: inputs.triggerHash },
		};
	},
	async update(_id: string, _olds: InvalidationInputs, news: InvalidationInputs) {
		const { CloudFrontClient, CreateInvalidationCommand } = await import("@aws-sdk/client-cloudfront");
		const client = new CloudFrontClient({});
		await client.send(
			new CreateInvalidationCommand({
				DistributionId: news.distributionId,
				InvalidationBatch: {
					CallerReference: `pulumi-${Date.now()}-${randomUUID()}`,
					Paths: { Quantity: 1, Items: ["/*"] },
				},
			}),
		);
		return { outs: { distributionId: news.distributionId, triggerHash: news.triggerHash } };
	},
	async diff(_id: string, olds: InvalidationInputs, news: InvalidationInputs) {
		return { changes: olds.triggerHash !== news.triggerHash };
	},
};

class CloudFrontInvalidation extends pulumi.dynamic.Resource {
	constructor(
		name: string,
		args: { distributionId: pulumi.Input<string>; triggerHash: pulumi.Input<string> },
		opts?: pulumi.CustomResourceOptions,
	) {
		super(invalidationProvider, name, args, opts);
	}
}

/**
 * Resource-naming convention:
 *   staticDomains[0]     — legacy primary; keeps the original Pulumi names
 *                          (`${name}`, `${name}-cdn`) so existing deployments see a no-op.
 *   staticDomains[1..]   — additional canonicals; each gets its own cert, CloudFront
 *                          distribution, and Route53 record with suffixed names.
 *   staticDomains[last]  — canonical user-facing origin (used for `baseUrl`, i.e. the
 *                          STATIC_BASE_URL referenced in server-rendered HTML). Latest
 *                          entry wins so migrating to a new canonical just means appending.
 */
export class HutchStaticAssets extends pulumi.ComponentResource {
	public readonly baseUrl: pulumi.Output<string>;
	public readonly distributions: aws.cloudfront.Distribution[];

	constructor(
		name: string,
		args: {
			bucketName: string;
			staticDomains: StaticDomainEntry[];
			domains: string[];
			sourceDir: string;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchStaticAssets", name, {}, opts);

		assert(args.staticDomains.length > 0, "staticDomains must have at least one entry");
		assert(path.isAbsolute(args.sourceDir), "sourceDir must be an absolute path");

		const publicBucket = new HutchS3PublicRead(name, {
			bucketName: args.bucketName,
			bucketOpts: { aliases: [{ name: `${name}-bucket`, parent: pulumi.rootStackResource }] },
		}, { parent: this });

		const files = walkStaticAssets(args.sourceDir);
		assert(files.length > 0, `sourceDir ${args.sourceDir} contains no files`);

		const bucketObjects = files.map(({ key, absolutePath }) =>
			new aws.s3.BucketObjectv2(
				`${name}-object-${key.replace(/[^a-zA-Z0-9]/g, "-")}`,
				{
					bucket: publicBucket.bucket,
					key,
					source: new pulumi.asset.FileAsset(absolutePath),
					contentType: contentTypeFor(key),
					cacheControl: "public, max-age=300, s-maxage=31536000",
				},
				{ parent: this },
			),
		);

		const corsOrigins =
			args.domains.length > 0
				? args.domains.map((d) => `https://${d}`)
				: ["*"];

		const responseHeadersPolicy = new aws.cloudfront.ResponseHeadersPolicy(
			`${name}-response-headers`,
			{
				name: `${name}-cors-headers`,
				corsConfig: {
					accessControlAllowCredentials: false,
					accessControlAllowHeaders: { items: ["*"] },
					accessControlAllowMethods: { items: ["GET", "HEAD"] },
					accessControlAllowOrigins: { items: corsOrigins },
					originOverride: true,
				},
			},
			{ parent: this, aliases: [{ parent: pulumi.rootStackResource }] },
		);

		const hasAnyZone = args.staticDomains.some((sd) => sd.zoneId !== undefined);
		const usEast1 = hasAnyZone
			? new aws.Provider(
					`${name}-us-east-1`,
					{ region: "us-east-1" },
					{ parent: this, aliases: [{ parent: pulumi.rootStackResource }] },
				)
			: undefined;

		const distributions: aws.cloudfront.Distribution[] = [];

		for (const [i, entry] of args.staticDomains.entries()) {
			const safeName = entry.domain.replace(/\./g, "-");
			const nameSuffix = i === 0 ? "" : `-${safeName}`;

			let viewerCertificate: aws.types.input.cloudfront.DistributionViewerCertificate;
			let distributionAliases: pulumi.Input<string>[] | undefined;

			if (entry.zoneId && usEast1) {
				const cert = new HutchCertificate(
					`${name}${nameSuffix}`,
					{
						primaryDomain: entry.domain,
						altDomains: [],
						zoneId: entry.zoneId,
						provider: usEast1,
					},
					{ parent: this },
				);
				viewerCertificate = {
					acmCertificateArn: cert.certificateArn,
					sslSupportMethod: "sni-only",
					minimumProtocolVersion: "TLSv1.2_2021",
				};
				distributionAliases = [entry.domain];
			} else {
				viewerCertificate = { cloudfrontDefaultCertificate: true };
			}

			const distribution = new aws.cloudfront.Distribution(
				`${name}-cdn${nameSuffix}`,
				{
					enabled: true,
					aliases: distributionAliases,
					origins: [
						{
							originId: "s3",
							domainName: publicBucket.bucketRegionalDomainName,
						},
					],
					defaultCacheBehavior: {
						targetOriginId: "s3",
						viewerProtocolPolicy: "redirect-to-https",
						allowedMethods: ["GET", "HEAD"],
						cachedMethods: ["GET", "HEAD"],
						compress: true,
						cachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
						responseHeadersPolicyId: responseHeadersPolicy.id,
					},
					restrictions: {
						geoRestriction: {
							restrictionType: "none",
						},
					},
					viewerCertificate,
					priceClass: "PriceClass_100",
				},
				{
					parent: this,
					aliases: i === 0 ? [{ parent: pulumi.rootStackResource }] : undefined,
				},
			);

			distributions.push(distribution);

			if (entry.zoneId) {
				new aws.route53.Record(
					`${name}-record-${safeName}`,
					{
						zoneId: entry.zoneId,
						name: entry.domain,
						type: "A",
						aliases: [
							{
								name: distribution.domainName,
								zoneId: distribution.hostedZoneId,
								evaluateTargetHealth: false,
							},
						],
					},
					{ parent: this, aliases: [{ parent: pulumi.rootStackResource }] },
				);
			}
		}

		this.distributions = distributions;

		const triggerHash: pulumi.Output<string> = pulumi
			.all(bucketObjects.map((o) => o.etag))
			.apply((etags) => {
				const hasher = createHash("sha256");
				for (const etag of etags.slice().sort()) hasher.update(etag);
				return hasher.digest("hex");
			});

		for (const [i, distribution] of distributions.entries()) {
			const entry = args.staticDomains[i];
			assert(entry, `staticDomain entry missing at index ${i}`);
			const safeName = entry.domain.replace(/\./g, "-");
			const nameSuffix = i === 0 ? "" : `-${safeName}`;
			new CloudFrontInvalidation(
				`${name}-invalidation${nameSuffix}`,
				{
					distributionId: distribution.id,
					triggerHash,
				},
				{ parent: this, dependsOn: bucketObjects },
			);
		}

		const canonicalStaticDomain = args.staticDomains[args.staticDomains.length - 1];
		assert(canonicalStaticDomain, "staticDomains must have at least one entry");
		this.baseUrl = pulumi.output(`https://${canonicalStaticDomain.domain}`);
		this.registerOutputs();
	}
}
