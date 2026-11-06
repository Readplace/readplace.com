import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { S3Client } from "@aws-sdk/client-s3";
import { TranscribeClient } from "@aws-sdk/client-transcribe";
import { initDynamoDbPrivateItemMedia } from "@packages/article-store";
import {
	EventBridgeClient,
	initEventBridgePublisher,
} from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initPutTierSource } from "@packages/tier-source";
import { initDynamoDbTranscriptLedger } from "@packages/transcript-quota";
import { initWriteMinimalAudioBody } from "./minimal-body/write-minimal-audio-body";
import { PREPARE_TRANSCRIPTION_ENV } from "./prepare-transcription.env";
import {
	initPrepareTranscriptionHandler,
	type TranscriptionStarted,
} from "./prepare/prepare-transcription-handler";
import {
	type ExecFile,
	initRunFfmpeg,
	initRunFfprobe,
} from "./prepare/run-ffprobe";
import { initS3TranscriptFiles } from "./s3/s3-transcript-files";
import { initTranscribeJobs } from "./transcribe/transcribe-jobs";

const env = readEnv(PREPARE_TRANSCRIPTION_ENV);

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const execFileText = promisify(execFile);
const runBinary: ExecFile = (file, args) => execFileText(file, args);

const { findArticleMedia } = initDynamoDbPrivateItemMedia({
	client: dynamoClient,
	tableName: env.DYNAMODB_ARTICLES_TABLE,
});
const { stagedInputUrl, putTranscriptFile, putJobRequest, deletePrefix } =
	initS3TranscriptFiles({
		client: s3Client,
		bucketName: env.MEDIA_BUCKET_NAME,
	});
const { refundUnstartedCharge, markTranscriptStarted } =
	initDynamoDbTranscriptLedger({
		client: dynamoClient,
		tableName: env.MEDIA_TABLE_NAME,
		now: () => new Date(),
		delay: (milliseconds) =>
			new Promise((resolve) => setTimeout(resolve, milliseconds)),
	});
const { startTranscriptionJob } = initTranscribeJobs({
	client: new TranscribeClient({}),
	bucketName: env.MEDIA_BUCKET_NAME,
});
const { putTierSource } = initPutTierSource({
	client: s3Client,
	bucketName: env.CONTENT_BUCKET_NAME,
});
const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: env.EVENT_BUS_NAME,
});

export const handler = initPrepareTranscriptionHandler({
	findArticleMedia,
	stagedInputUrl,
	runFfprobe: initRunFfprobe({ execFile: runBinary }),
	runFfmpeg: initRunFfmpeg({ execFile: runBinary }),
	putTranscriptFile,
	removeTmpFile: (path) => rm(path, { force: true }),
	putJobRequest,
	deletePrefix,
	refundUnstartedCharge,
	markTranscriptStarted,
	startTranscriptionJob,
	writeMinimalAudioBody: initWriteMinimalAudioBody({
		putTierSource,
		publishEvent,
	}),
	tmpDir: tmpdir(),
	startedLog: Logger.fromJSON<TranscriptionStarted>(),
	logger: Logger.from(consoleLogger),
});
