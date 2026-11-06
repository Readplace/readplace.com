import { readFileSync } from "node:fs";
import * as pulumi from "@pulumi/pulumi";
import {
	attachDlqConsumer,
	DynamoDBAccess,
	EventBus,
	Lambda,
	MediaProcessor,
	S3ReadWrite,
	SharedDlq,
	Sqs,
	SqsBackedLambda,
} from "@packages/infra-components/infra";
import { MEDIA_AUDIO_DLQ_SOURCES, MediaUploadCommittedEvent } from "@packages/infra-components";
import { KEEP_AUDIO_ENV } from "../runtime/keep-audio.env";
import { MEDIA_AUDIO_FAILURES_DLQ_ENV } from "../runtime/media-audio-failures-dlq.env";
import { PREPARE_TRANSCRIPTION_ENV } from "../runtime/prepare-transcription.env";
import { z } from "zod";

const MEDIA_AUDIO_FAILURES_DLQ = "media-audio-failures";

const config = new pulumi.Config();
const alertEmail = config.require("alertEmail");
const contentBucketName = config.require("contentBucketName");
const mediaBucketName = config.require("mediaBucketName");
const mediaTableName = config.require("mediaTableName");
const mediaTableArn = config.require("mediaTableArn");
const articlesTableName = config.require("articlesTableName");
const articlesTableArn = config.require("articlesTableArn");

const eventBus = EventBus.fromPlatformStack(config);

const failuresDlq = new SharedDlq(MEDIA_AUDIO_FAILURES_DLQ, {
	alertEmailDLQEntry: alertEmail,
});

const mediaDynamodb = new DynamoDBAccess("media-audio-keep-audio-media-dynamodb", {
	tables: [{ arn: mediaTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:ConditionCheckItem", "dynamodb:Query"],
});

const articlesDynamodb = new DynamoDBAccess("media-audio-keep-audio-articles-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

new MediaProcessor(MEDIA_AUDIO_DLQ_SOURCES.keepAudio, {
	eventBus,
	event: MediaUploadCommittedEvent,
	kinds: ["audio"],
	subscriptionName: "media-audio-keep-audio",
	sharedDlq: failuresDlq,
	alertEmailDLQEntry: alertEmail,
	lambda: {
		entryPoint: "./src/runtime/keep-audio.main.ts",
		outputDir: ".lib/media-audio-keep-audio",
		assetDir: "./src/runtime",
		memorySize: 1024,
		timeout: 120,
		environmentNames: KEEP_AUDIO_ENV,
		environment: {
			MEDIA_BUCKET_NAME: mediaBucketName,
			MEDIA_TABLE_NAME: mediaTableName,
			CONTENT_BUCKET_NAME: contentBucketName,
			DYNAMODB_ARTICLES_TABLE: articlesTableName,
			EVENT_BUS_NAME: eventBus.eventBusName,
		},
		policies: [
			{
				name: "media-audio-pending-read",
				policy: JSON.stringify({
					Version: "2012-10-17",
					Statement: [
						{ Effect: "Allow", Action: ["s3:GetObject"], Resource: `arn:aws:s3:::${mediaBucketName}/pending/*` },
						{ Effect: "Allow", Action: ["s3:ListBucket"], Resource: `arn:aws:s3:::${mediaBucketName}` },
					],
				}),
			},
			{
				name: "media-audio-objects-write",
				policy: JSON.stringify({
					Version: "2012-10-17",
					Statement: [
						{ Effect: "Allow", Action: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], Resource: `arn:aws:s3:::${mediaBucketName}/objects/*` },
					],
				}),
			},
			...S3ReadWrite.readPoliciesForBucket("media-audio-content-read", contentBucketName),
			...S3ReadWrite.writePoliciesForBucket("media-audio-content-write", contentBucketName),
			...mediaDynamodb.policies,
			...articlesDynamodb.policies,
		],
	},
});

const PREPARE_TRANSCRIPTION_TIMEOUT_SECONDS = 600;
const mediaAudioImageTags = z.object({ "prepare-transcription": z.string() }).parse(JSON.parse(readFileSync(".lib/media-audio-image-tags.json", "utf-8")));

const transcriptsObjects = `arn:aws:s3:::${mediaBucketName}/transcripts/*`;
const transcriptionJobs = "arn:aws:transcribe:*:*:transcription-job/rp-*";
const mediaBucketList = { Effect: "Allow", Action: ["s3:ListBucket"], Resource: `arn:aws:s3:::${mediaBucketName}` };

const transcriptLedgerDynamodb = new DynamoDBAccess("media-audio-transcript-ledger-dynamodb", {
	tables: [{ arn: mediaTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem"],
});

const articleReadDynamodb = new DynamoDBAccess("media-audio-transcription-articles-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem"],
});

const transcriptionEnvironment = {
	MEDIA_BUCKET_NAME: mediaBucketName,
	MEDIA_TABLE_NAME: mediaTableName,
	DYNAMODB_ARTICLES_TABLE: articlesTableName,
	CONTENT_BUCKET_NAME: contentBucketName,
	EVENT_BUS_NAME: eventBus.eventBusName,
};

const prepareTranscriptionLambda = new Lambda(MEDIA_AUDIO_DLQ_SOURCES.prepareTranscription, {
	memorySize: 1769,
	timeout: PREPARE_TRANSCRIPTION_TIMEOUT_SECONDS,
	ephemeralStorageSize: 2048,
	containerImage: { imageUri: mediaAudioImageTags["prepare-transcription"] },
	environmentNames: PREPARE_TRANSCRIPTION_ENV,
	environment: transcriptionEnvironment,
	policies: [
		{
			name: "media-audio-prepare-transcription-s3",
			policy: JSON.stringify({
				Version: "2012-10-17",
				Statement: [
					{ Effect: "Allow", Action: ["s3:GetObject"], Resource: `arn:aws:s3:::${mediaBucketName}/pending/*` },
					{ Effect: "Allow", Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource: transcriptsObjects },
					mediaBucketList,
				],
			}),
		},
		{
			name: "media-audio-prepare-transcription-start-job",
			policy: JSON.stringify({
				Version: "2012-10-17",
				Statement: [{ Effect: "Allow", Action: ["transcribe:StartTranscriptionJob"], Resource: transcriptionJobs }],
			}),
		},
		...S3ReadWrite.readPoliciesForBucket("media-audio-prepare-transcription-content-read", contentBucketName),
		...S3ReadWrite.writePoliciesForBucket("media-audio-prepare-transcription-content-write", contentBucketName),
		...transcriptLedgerDynamodb.policies,
		...articleReadDynamodb.policies,
	],
});

const prepareTranscriptionQueue = new Sqs(MEDIA_AUDIO_DLQ_SOURCES.prepareTranscription, {
	visibilityTimeoutSeconds: 2 * PREPARE_TRANSCRIPTION_TIMEOUT_SECONDS,
	dlqMaxReceiveCount: 3,
	sharedDlq: failuresDlq,
});

const prepareTranscription = new SqsBackedLambda(MEDIA_AUDIO_DLQ_SOURCES.prepareTranscription, {
	lambda: prepareTranscriptionLambda,
	queue: prepareTranscriptionQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.grantPublish(prepareTranscriptionLambda);
eventBus.subscribe(MediaUploadCommittedEvent, prepareTranscription, {
	name: "media-audio-prepare-transcription",
	detail: { kind: ["audio"] },
});

const failuresDlqLambda = new Lambda(`${MEDIA_AUDIO_FAILURES_DLQ}-dlq`, {
	entryPoint: `./src/runtime/${MEDIA_AUDIO_FAILURES_DLQ}-dlq.main.ts`,
	outputDir: `.lib/${MEDIA_AUDIO_FAILURES_DLQ}-dlq`,
	assetDir: "./src/runtime",
	memorySize: 256,
	timeout: 30,
	environmentNames: MEDIA_AUDIO_FAILURES_DLQ_ENV,
	environment: transcriptionEnvironment,
	policies: [
		{
			name: "media-audio-failures-dlq-transcripts",
			policy: JSON.stringify({
				Version: "2012-10-17",
				Statement: [
					{ Effect: "Allow", Action: ["s3:GetObject", "s3:DeleteObject"], Resource: transcriptsObjects },
					mediaBucketList,
					{ Effect: "Allow", Action: ["transcribe:GetTranscriptionJob"], Resource: transcriptionJobs },
				],
			}),
		},
		...S3ReadWrite.readPoliciesForBucket("media-audio-failures-dlq-content-read", contentBucketName),
		...S3ReadWrite.writePoliciesForBucket("media-audio-failures-dlq-content-write", contentBucketName),
		...transcriptLedgerDynamodb.policies,
		...articleReadDynamodb.policies,
	],
});

eventBus.grantPublish(failuresDlqLambda);

attachDlqConsumer(`${MEDIA_AUDIO_FAILURES_DLQ}-dlq`, {
	deadLetterQueue: failuresDlq,
	lambda: failuresDlqLambda,
	batchSize: 1,
});
