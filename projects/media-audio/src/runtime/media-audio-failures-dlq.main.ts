import { initDeadLetterRouter } from "@packages/dead-letter-routing";
import { MEDIA_AUDIO_DLQ_SOURCE_QUEUES } from "@packages/infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { MEDIA_AUDIO_FAILURES_DLQ_ENV } from "./media-audio-failures-dlq.env";
import { initKeepAudioDlqHandler } from "./keep-audio/media-audio-failures-dlq-handler";

const env = readEnv(MEDIA_AUDIO_FAILURES_DLQ_ENV);

const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: env.EVENT_BUS_NAME });

export const handler = initDeadLetterRouter({
	routes: {
		[MEDIA_AUDIO_DLQ_SOURCE_QUEUES.keepAudio]: initKeepAudioDlqHandler({
			publishEvent,
			logger: Logger.from(consoleLogger),
		}),
	},
});
