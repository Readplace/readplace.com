import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import type { LambdaPolicy } from "./hutch-lambda";

/** A single S3 lifecycle expiration rule that targets one or more key prefixes. */
interface BucketExpirationRule {
	id: string;
	expirationDays: number;
	prefixes: string[];
}

export class HutchS3ReadWrite extends pulumi.ComponentResource {
	public readonly bucket: aws.s3.Bucket["bucket"];
	public readonly arn: aws.s3.Bucket["arn"];
	public readonly bucketRegionalDomainName: aws.s3.Bucket["bucketRegionalDomainName"];

	private readonly readPolicyDocument: pulumi.Output<string>;
	private readonly writePolicyDocument: pulumi.Output<string>;

	constructor(
		name: string,
		args: {
			bucketName: pulumi.Input<string>;
			expirationRules?: BucketExpirationRule[];
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchS3ReadWrite", name, {}, opts);

		const bucket = new aws.s3.Bucket(name, {
			bucket: args.bucketName,
			forceDestroy: false,
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		new aws.s3.BucketPublicAccessBlock(`${name}-public-access`, {
			bucket: bucket.id,
			blockPublicAcls: true,
			blockPublicPolicy: true,
			ignorePublicAcls: true,
			restrictPublicBuckets: true,
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		if (args.expirationRules && args.expirationRules.length > 0) {
			new aws.s3.BucketLifecycleConfigurationV2(`${name}-lifecycle`, {
				bucket: bucket.id,
				rules: args.expirationRules.flatMap((rule) =>
					rule.prefixes.map((prefix) => ({
						id: `${rule.id}-${prefix.replace(/[/]/g, "-")}`,
						status: "Enabled",
						filter: { prefix },
						expiration: { days: rule.expirationDays },
					})),
				),
			}, { parent: this });
		}

		this.bucket = bucket.bucket;
		this.arn = bucket.arn;
		this.bucketRegionalDomainName = bucket.bucketRegionalDomainName;

		this.readPolicyDocument = bucket.arn.apply((arn) =>
			JSON.stringify({
				Version: "2012-10-17",
				Statement: [
					{ Effect: "Allow", Action: ["s3:GetObject"], Resource: `${arn}/*` },
					// s3:ListBucket on the bucket itself (not /*) so a missing key returns
					// 404 NoSuchKey instead of S3's information-hiding 403 AccessDenied that
					// names s3:ListBucket — the latter shows up in CloudWatch as a misleading
					// permission failure on every cache miss.
					{ Effect: "Allow", Action: ["s3:ListBucket"], Resource: arn },
				],
			}),
		);

		this.writePolicyDocument = bucket.arn.apply((arn) =>
			JSON.stringify({
				Version: "2012-10-17",
				Statement: [{ Effect: "Allow", Action: ["s3:PutObject"], Resource: `${arn}/*` }],
			}),
		);

		this.registerOutputs();
	}

	readPolicies(name: string): LambdaPolicy[] {
		return [{ name: `${name}-read-pol`, policy: this.readPolicyDocument }];
	}

	writePolicies(name: string): LambdaPolicy[] {
		return [{ name: `${name}-write-pol`, policy: this.writePolicyDocument }];
	}

	static readPoliciesForBucket(name: string, bucketName: string): LambdaPolicy[] {
		return [{
			name: `${name}-read-pol`,
			policy: JSON.stringify({
				Version: "2012-10-17",
				Statement: [
					{ Effect: "Allow", Action: ["s3:GetObject"], Resource: `arn:aws:s3:::${bucketName}/*` },
					// See readPolicyDocument above for why s3:ListBucket is required on the bucket itself.
					{ Effect: "Allow", Action: ["s3:ListBucket"], Resource: `arn:aws:s3:::${bucketName}` },
				],
			}),
		}];
	}

	static writePoliciesForBucket(name: string, bucketName: string): LambdaPolicy[] {
		return [{
			name: `${name}-write-pol`,
			policy: JSON.stringify({
				Version: "2012-10-17",
				Statement: [{ Effect: "Allow", Action: ["s3:PutObject"], Resource: `arn:aws:s3:::${bucketName}/*` }],
			}),
		}];
	}
}
