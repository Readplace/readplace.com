import { initDeadLetterRouter } from "@packages/dead-letter-routing";
import { MEDIA_BOOK_DLQ_SOURCE_QUEUES } from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { requireEnv } from "@packages/require-env";
import { initProcessBookDlqHandler } from "./process-book/media-book-failures-dlq-handler";

const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });

export const handler = initDeadLetterRouter({
	routes: {
		[MEDIA_BOOK_DLQ_SOURCE_QUEUES.processBook]: initProcessBookDlqHandler({
			publishEvent,
			logger: HutchLogger.from(consoleLogger),
		}),
	},
});
