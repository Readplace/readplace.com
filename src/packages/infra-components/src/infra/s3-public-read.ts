import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export class S3PublicRead extends pulumi.ComponentResource {
	public readonly bucket: aws.s3.Bucket["bucket"];
	public readonly arn: aws.s3.Bucket["arn"];
	public readonly bucketRegionalDomainName: aws.s3.Bucket["bucketRegionalDomainName"];
	public readonly bucketPolicy: aws.s3.BucketPolicy;

	constructor(
		name: string,
		args: {
			bucketName: pulumi.Input<string>;
			allowListBucket?: boolean;
			bucketOpts?: pulumi.CustomResourceOptions;
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("hutch:infra:HutchS3PublicRead", name, {}, opts);

		const bucket = new aws.s3.Bucket(name, {
			bucket: args.bucketName,
			forceDestroy: true,
		}, {
			...args.bucketOpts,
			parent: this,
			aliases: [
				...(args.bucketOpts?.aliases ?? []),
				{ parent: pulumi.rootStackResource },
			],
		});

		const publicAccessBlock = new aws.s3.BucketPublicAccessBlock(`${name}-public-access`, {
			bucket: bucket.id,
			blockPublicAcls: false,
			blockPublicPolicy: false,
			ignorePublicAcls: false,
			restrictPublicBuckets: false,
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.bucketPolicy = new aws.s3.BucketPolicy(
			`${name}-policy`,
			{
				bucket: bucket.id,
				policy: bucket.arn.apply((arn) => {
					const statements = [
						{
							Sid: "PublicReadGetObject",
							Effect: "Allow",
							Principal: "*",
							Action: "s3:GetObject",
							Resource: `${arn}/*`,
						},
					];

					if (args.allowListBucket) {
						statements.push({
							Sid: "PublicListBucket",
							Effect: "Allow",
							Principal: "*",
							Action: "s3:ListBucket",
							Resource: arn,
						});
					}

					return JSON.stringify({
						Version: "2012-10-17",
						Statement: statements,
					});
				}),
			},
			{ dependsOn: [publicAccessBlock], parent: this, aliases: [{ parent: pulumi.rootStackResource }] },
		);

		this.bucket = bucket.bucket;
		this.arn = bucket.arn;
		this.bucketRegionalDomainName = bucket.bucketRegionalDomainName;
		this.registerOutputs();
	}
}
