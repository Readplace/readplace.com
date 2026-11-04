import type { GmailForwardingConfirmFailedLine } from "@packages/infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { CONFIRM_GMAIL_FORWARDING_ENV } from "./confirm-gmail-forwarding.env";
import { initConfirmForwardingAddress } from "./domain/gmail/confirm-forwarding-address";
import { initConfirmGmailForwardingHandler } from "./domain/gmail/confirm-gmail-forwarding-handler";

const env = readEnv(CONFIRM_GMAIL_FORWARDING_ENV);

const eventBusName = env.EVENT_BUS_NAME;

const logger = Logger.from(consoleLogger);
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
	metricLog: Logger.fromJSON<GmailForwardingConfirmFailedLine>(),
	logger,
});
