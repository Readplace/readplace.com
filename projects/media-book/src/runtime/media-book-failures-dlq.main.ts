import { initDeadLetterRouter } from "@packages/dead-letter-routing";
import { MEDIA_BOOK_DLQ_SOURCE_QUEUES } from "@packages/infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { MEDIA_BOOK_FAILURES_DLQ_ENV } from "./media-book-failures-dlq.env";
import { initProcessBookDlqHandler } from "./process-book/media-book-failures-dlq-handler";

const env = readEnv(MEDIA_BOOK_FAILURES_DLQ_ENV);

const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: env.EVENT_BUS_NAME });

export const handler = initDeadLetterRouter({
	routes: {
		[MEDIA_BOOK_DLQ_SOURCE_QUEUES.processBook]: initProcessBookDlqHandler({
			publishEvent,
			logger: Logger.from(consoleLogger),
		}),
	},
});
