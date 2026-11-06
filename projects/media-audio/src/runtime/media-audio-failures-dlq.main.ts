import { S3Client } from "@aws-sdk/client-s3";
import { TranscribeClient } from "@aws-sdk/client-transcribe";
import { initDynamoDbPrivateItemMedia } from "@packages/article-store";
import { initDeadLetterRouter } from "@packages/dead-letter-routing";
import { MEDIA_AUDIO_DLQ_SOURCE_QUEUES } from "@packages/infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initPutTierSource } from "@packages/tier-source";
import { initDynamoDbTranscriptLedger } from "@packages/transcript-quota";
import { MEDIA_AUDIO_FAILURES_DLQ_ENV } from "./media-audio-failures-dlq.env";
import { initKeepAudioDlqHandler } from "./keep-audio/media-audio-failures-dlq-handler";
import { initWriteMinimalAudioBody } from "./minimal-body/write-minimal-audio-body";
import { initPrepareTranscriptionDlqHandler } from "./prepare/prepare-transcription-dlq-handler";
import { initS3TranscriptFiles } from "./s3/s3-transcript-files";
import { initTranscribeJobs } from "./transcribe/transcribe-jobs";

const env = readEnv(MEDIA_AUDIO_FAILURES_DLQ_ENV);

const s3Client = new S3Client({});
const dynamoClient = createDynamoDocumentClient();
const logger = Logger.from(consoleLogger);

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: env.EVENT_BUS_NAME,
});
const { findArticleMedia } = initDynamoDbPrivateItemMedia({
	client: dynamoClient,
	tableName: env.DYNAMODB_ARTICLES_TABLE,
});
const { readJobRequest, deletePrefix } = initS3TranscriptFiles({
	client: s3Client,
	bucketName: env.MEDIA_BUCKET_NAME,
});
const { refundTranscriptCharge } = initDynamoDbTranscriptLedger({
	client: dynamoClient,
	tableName: env.MEDIA_TABLE_NAME,
	now: () => new Date(),
	delay: (milliseconds) =>
		new Promise((resolve) => setTimeout(resolve, milliseconds)),
});
const { getTranscriptionJob } = initTranscribeJobs({
	client: new TranscribeClient({}),
	bucketName: env.MEDIA_BUCKET_NAME,
});
const { putTierSource } = initPutTierSource({
	client: s3Client,
	bucketName: env.CONTENT_BUCKET_NAME,
});

export const handler = initDeadLetterRouter({
	routes: {
		[MEDIA_AUDIO_DLQ_SOURCE_QUEUES.keepAudio]: initKeepAudioDlqHandler({
			publishEvent,
			logger,
		}),
		[MEDIA_AUDIO_DLQ_SOURCE_QUEUES.prepareTranscription]:
			initPrepareTranscriptionDlqHandler({
				getTranscriptionJob,
				findArticleMedia,
				refundTranscriptCharge,
				readJobRequest,
				deletePrefix,
				writeMinimalAudioBody: initWriteMinimalAudioBody({
					putTierSource,
					publishEvent,
				}),
				logger,
			}),
	},
});
