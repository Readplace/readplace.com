import { execFile } from "node:child_process";
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
import { initMediaObjectStore } from "@packages/media-object-store";
import { initDynamoDbTranscriptLedger } from "@packages/transcript-quota";
import type { MediaAudioKind } from "./media-audio-kinds";
import { initWriteMinimalAudioBody } from "./minimal-body/write-minimal-audio-body";
import { PREPARE_TRANSCRIPTION_ENV } from "./prepare-transcription.env";
import { initExtractAudio } from "./prepare/extract-audio";
import {
	initPrepareTranscriptionHandler,
	type PrepareStep,
	type TranscriptionStarted,
} from "./prepare/prepare-transcription-handler";
import { hashFile, removeFile } from "./prepare/rendition-file";
import {
	type ExecFile,
	initProbeFileDuration,
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

const { findArticleMedia, setArticleEnclosure } = initDynamoDbPrivateItemMedia({
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

const mediaObjects = initMediaObjectStore({
	client: dynamoClient,
	tableName: env.MEDIA_TABLE_NAME,
	s3: s3Client,
	bucketName: env.MEDIA_BUCKET_NAME,
});
const runFfprobe = initRunFfprobe({ execFile: runBinary });
const runFfmpeg = initRunFfmpeg({ execFile: runBinary });
const tmpDir = tmpdir();

const PREPARE_STEPS = {
	audio: async () => "proceed",
	video: initExtractAudio({
		runFfprobe,
		runFfmpeg,
		probeFileDuration: initProbeFileDuration({ execFile: runBinary }),
		hashFile,
		mediaObjects,
		setArticleEnclosure,
		putLocalFile: putTranscriptFile,
		removeFile,
		tmpDir,
	}),
} satisfies Record<MediaAudioKind, PrepareStep>;

export const handler = initPrepareTranscriptionHandler({
	findArticleMedia,
	stagedInputUrl,
	prepareSteps: PREPARE_STEPS,
	unrefAll: mediaObjects.unrefAll,
	publishEvent,
	runFfprobe,
	runFfmpeg,
	putTranscriptFile,
	removeTmpFile: removeFile,
	putJobRequest,
	deletePrefix,
	refundUnstartedCharge,
	markTranscriptStarted,
	startTranscriptionJob,
	writeMinimalAudioBody: initWriteMinimalAudioBody({
		putTierSource,
		publishEvent,
	}),
	tmpDir,
	startedLog: Logger.fromJSON<TranscriptionStarted>(),
	logger: Logger.from(consoleLogger),
});
