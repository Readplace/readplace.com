import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { EcrRepository, EventBus, S3ReadWrite } from "@packages/infra-components/infra";

const config = new pulumi.Config();
const eventBusName = config.require("eventBusName");
const ocrLambdaRepositoryName = config.require("ocrLambdaRepositoryName");
const mediaLambdaRepositoryName = config.require("mediaLambdaRepositoryName");
const deletionProtection = config.requireBoolean("deletionProtection");

const eventBus = EventBus.create("hutch", { eventBusName });

const ocrLambdaRepository = EcrRepository.create("hutch-ocr-lambda", {
	repositoryName: ocrLambdaRepositoryName,
	keepLastNImages: 200,
});

EcrRepository.create("hutch-media-lambda", {
	repositoryName: mediaLambdaRepositoryName,
	keepLastNImages: 200,
});

new S3ReadWrite("hutch-media-bucket", {
	bucketName: config.require("mediaBucketName"),
	expirationRules: [
		{ id: "pending", expirationDays: 2, prefixes: ["pending/"] },
		{ id: "transcripts", expirationDays: 14, prefixes: ["transcripts/"] },
	],
	corsRules: [
		{
			allowedMethods: ["POST"],
			allowedOrigins: ["*"],
			allowedHeaders: ["*"],
			exposeHeaders: ["ETag"],
			maxAgeSeconds: 3600,
		},
	],
});

new aws.dynamodb.Table("hutch-media-table", {
	name: config.require("mediaTableName"),
	billingMode: "PAY_PER_REQUEST",
	hashKey: "pk",
	rangeKey: "sk",
	attributes: [{ name: "pk", type: "S" }, { name: "sk", type: "S" }],
	pointInTimeRecovery: { enabled: true },
	ttl: { attributeName: "expiresAt", enabled: true },
	deletionProtectionEnabled: deletionProtection,
});

// The curl_chrome131 bash wrapper + statically-linked curl-impersonate binary
// (BoringSSL embedded) that produce a Chrome TLS fingerprint, bypassing
// Akamai/Cloudflare JA3/JA4 blocks. It lives here rather than in the one
// project that first shipped it because three project stacks (save-link, inbox,
// hutch) each run the crawl fallback chain and so need the binary — and
// deploy-platform runs before the project matrix, so the ARN is persisted
// before any consumer reads it via StackReference.
const curlImpersonateLayer = new aws.lambda.LayerVersion("curl-impersonate", {
	layerName: "curl-impersonate-chrome",
	compatibleRuntimes: [aws.lambda.Runtime.NodeJS22dX],
	code: new pulumi.asset.FileArchive(".lib/curl-impersonate-layer.zip"),
	description: "curl-impersonate Chrome variant (curl_chrome131) for TLS fingerprint bypass",
});

const ssrEdgeSecretValue = new random.RandomPassword("ssr-edge-secret", {
	length: 48,
	special: false,
});

const pulumiStateSecretsKey = new aws.kms.Key("pulumi-state-secrets", {
	description: "Encrypts the secret values in every Pulumi stack's state",
});

new aws.kms.Alias("pulumi-state-secrets", {
	name: "alias/pulumi-state-secrets",
	targetKeyId: pulumiStateSecretsKey.keyId,
});

const auditTrailName = "hutch-audit-trail";
const awsRegion = new pulumi.Config("aws").require("region");
const awsAccountId = pulumi.output(aws.getCallerIdentity({})).accountId;

const auditTrailBucket = new aws.s3.Bucket("audit-trail", {
	bucket: config.require("auditTrailBucketName"),
});

const auditTrailBucketPolicy = new aws.s3.BucketPolicy("audit-trail", {
	bucket: auditTrailBucket.bucket,
	policy: pulumi.all([auditTrailBucket.arn, awsAccountId]).apply(([bucketArn, accountId]) => {
		const trailArn = `arn:aws:cloudtrail:${awsRegion}:${accountId}:trail/${auditTrailName}`;
		return JSON.stringify({
			Version: "2012-10-17",
			Statement: [
				{
					Sid: "AWSCloudTrailAclCheck20150319",
					Effect: "Allow",
					Principal: { Service: "cloudtrail.amazonaws.com" },
					Action: "s3:GetBucketAcl",
					Resource: bucketArn,
					Condition: { StringEquals: { "aws:SourceArn": trailArn } },
				},
				{
					Sid: "AWSCloudTrailWrite20150319",
					Effect: "Allow",
					Principal: { Service: "cloudtrail.amazonaws.com" },
					Action: "s3:PutObject",
					Resource: `${bucketArn}/AWSLogs/${accountId}/*`,
					Condition: {
						StringEquals: {
							"s3:x-amz-acl": "bucket-owner-full-control",
							"aws:SourceArn": trailArn,
						},
					},
				},
			],
		});
	}),
});

new aws.cloudtrail.Trail(
	"audit-trail",
	{
		name: auditTrailName,
		s3BucketName: auditTrailBucket.bucket,
		isMultiRegionTrail: true,
	},
	{ dependsOn: [auditTrailBucketPolicy] },
);

export const hutchEventBusName = eventBus.eventBusName;
export const hutchEventBusArn = eventBus.eventBusArn;
export const ocrLambdaRepositoryUrl = ocrLambdaRepository.repositoryUrl;
export const ocrLambdaRepositoryArn = ocrLambdaRepository.repositoryArn;
export const curlImpersonateLayerArn = curlImpersonateLayer.arn;
export const ssrEdgeSecret = ssrEdgeSecretValue.result;
