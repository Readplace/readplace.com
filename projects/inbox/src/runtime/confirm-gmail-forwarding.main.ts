import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { requireEnv } from "@packages/require-env";
import { initConfirmForwardingAddress } from "./domain/gmail/confirm-forwarding-address";
import { initConfirmGmailForwardingHandler } from "./domain/gmail/confirm-gmail-forwarding-handler";

const eventBusName = requireEnv("EVENT_BUS_NAME");

const logger = HutchLogger.from(consoleLogger);
const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

export const handler = initConfirmGmailForwardingHandler({
	confirmForwardingAddress: initConfirmForwardingAddress({
		fetch: globalThis.fetch,
		timeoutMs: 10_000,
	}),
	publishEvent,
	logger,
});
