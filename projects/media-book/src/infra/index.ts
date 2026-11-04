import * as pulumi from "@pulumi/pulumi";
import {
	attachDlqConsumer,
	DynamoDBAccess,
	EventBus,
	Lambda,
	MediaProcessor,
	S3ReadWrite,
	SharedDlq,
} from "@packages/infra-components/infra";
import { MEDIA_BOOK_DLQ_SOURCES, MediaUploadCommittedEvent } from "@packages/infra-components";

const MEDIA_BOOK_FAILURES_DLQ = "media-book-failures";

const config = new pulumi.Config();
const alertEmail = config.require("alertEmail");
const contentBucketName = config.require("contentBucketName");
const mediaBucketName = config.require("mediaBucketName");
const articlesTableName = config.require("articlesTableName");
const articlesTableArn = config.require("articlesTableArn");
const userArticlesTableName = config.require("userArticlesTableName");

const eventBus = EventBus.fromPlatformStack(config);

const failuresDlq = new SharedDlq(MEDIA_BOOK_FAILURES_DLQ, {
	alertEmailDLQEntry: alertEmail,
});

const articlesDynamodb = new DynamoDBAccess("media-book-process-book-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:UpdateItem"],
});

new MediaProcessor(MEDIA_BOOK_DLQ_SOURCES.processBook, {
	eventBus,
	event: MediaUploadCommittedEvent,
	kinds: ["book"],
	subscriptionName: "media-book-process-book",
	sharedDlq: failuresDlq,
	alertEmailDLQEntry: alertEmail,
	lambda: {
		entryPoint: "./src/runtime/process-book.main.ts",
		outputDir: ".lib/media-book-process-book",
		assetDir: "./src/runtime",
		memorySize: 1769,
		timeout: 900,
		ephemeralStorageSize: 2048,
		environment: {
			MEDIA_BUCKET_NAME: mediaBucketName,
			CONTENT_BUCKET_NAME: contentBucketName,
			DYNAMODB_ARTICLES_TABLE: articlesTableName,
			DYNAMODB_USER_ARTICLES_TABLE: userArticlesTableName,
			EVENT_BUS_NAME: eventBus.eventBusName,
		},
		policies: [
			{
				name: "media-book-pending-read",
				policy: JSON.stringify({
					Version: "2012-10-17",
					Statement: [
						{ Effect: "Allow", Action: ["s3:GetObject"], Resource: `arn:aws:s3:::${mediaBucketName}/pending/*` },
						{ Effect: "Allow", Action: ["s3:ListBucket"], Resource: `arn:aws:s3:::${mediaBucketName}` },
					],
				}),
			},
			{
				name: "media-book-images-write",
				policy: JSON.stringify({
					Version: "2012-10-17",
					Statement: [{ Effect: "Allow", Action: ["s3:PutObject"], Resource: `arn:aws:s3:::${mediaBucketName}/images/*` }],
				}),
			},
			...S3ReadWrite.readPoliciesForBucket("media-book-content-read", contentBucketName),
			...S3ReadWrite.writePoliciesForBucket("media-book-content-write", contentBucketName),
			...articlesDynamodb.policies,
		],
	},
});

const failuresDlqLambda = new Lambda(`${MEDIA_BOOK_FAILURES_DLQ}-dlq`, {
	entryPoint: `./src/runtime/${MEDIA_BOOK_FAILURES_DLQ}-dlq.main.ts`,
	outputDir: `.lib/${MEDIA_BOOK_FAILURES_DLQ}-dlq`,
	assetDir: "./src/runtime",
	memorySize: 256,
	timeout: 30,
	environment: {
		EVENT_BUS_NAME: eventBus.eventBusName,
	},
	policies: [],
});

eventBus.grantPublish(failuresDlqLambda);

attachDlqConsumer(`${MEDIA_BOOK_FAILURES_DLQ}-dlq`, {
	deadLetterQueue: failuresDlq,
	lambda: failuresDlqLambda,
	batchSize: 1,
});
