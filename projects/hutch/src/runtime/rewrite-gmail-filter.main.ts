import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbGmailConnection, initDynamoDbGmailCredentials, initDynamoDbGmailSender } from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import {
	DisconnectGmailCommand,
	GmailForwardingConfirmedEvent,
	RewriteGmailFilterCommand,
} from "@packages/hutch-infra-components";
import { initDisconnectGmail } from "./domain/gmail/disconnect-gmail";
import { initDisconnectGmailHandler } from "./domain/gmail/disconnect-gmail-handler";
import { initGmailForwardingConfirmedHandler } from "./domain/gmail/gmail-forwarding-confirmed-handler";
import { initRewriteGmailFilter } from "./domain/gmail/rewrite-gmail-filter";
import { initRewriteGmailFilterHandler } from "./domain/gmail/rewrite-gmail-filter-handler";
import { initHandleByDetailType } from "./handle-by-detail-type";
import { initGmailAccessToken } from "./providers/gmail-api/gmail-access-token";
import { initGmailFilters } from "./providers/gmail-api/gmail-filters";
import { initRevokeGmailGrant } from "./providers/gmail-api/gmail-revoke";

const logger = HutchLogger.from(consoleLogger);
const client = createDynamoDocumentClient();
const now = () => new Date();

const credentials = initDynamoDbGmailCredentials({
	client,
	tableName: requireEnv("DYNAMODB_GMAIL_CREDENTIALS_TABLE"),
	now,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: requireEnv("EVENT_BUS_NAME"),
});

const connections = initDynamoDbGmailConnection({
	client,
	tableName: requireEnv("DYNAMODB_GMAIL_CONNECTIONS_TABLE"),
	now,
});

const senders = initDynamoDbGmailSender({
	client,
	tableName: requireEnv("DYNAMODB_GMAIL_SENDERS_TABLE"),
	now,
});

const rewriteGmailFilter = initRewriteGmailFilter({
	filters: initGmailFilters({
		accessToken: initGmailAccessToken({
			clientId: requireEnv("GMAIL_INTEGRATION_CLIENT_ID"),
			clientSecret: requireEnv("GMAIL_INTEGRATION_CLIENT_SECRET"),
			credentials,
			fetch: globalThis.fetch,
			now,
		}),
		fetch: globalThis.fetch,
	}),
	connections,
	senders,
	now,
	logger,
});

const rewriteHandler = initRewriteGmailFilterHandler({
	rewriteGmailFilter,
	publishEvent,
	logger,
});

export const handler = initHandleByDetailType({
	routes: {
		[RewriteGmailFilterCommand.detailType]: [rewriteHandler],
		[GmailForwardingConfirmedEvent.detailType]: [
			initGmailForwardingConfirmedHandler({ connections, publishEvent, logger }),
		],
		[DisconnectGmailCommand.detailType]: [
			initDisconnectGmailHandler({
				disconnectGmail: initDisconnectGmail({
					connections,
					credentials,
					senders,
					rewriteGmailFilter,
					revokeGmailGrant: initRevokeGmailGrant({ fetch: globalThis.fetch }),
					logger,
				}),
				publishEvent,
				logger,
			}),
		],
	},
	logger,
});
