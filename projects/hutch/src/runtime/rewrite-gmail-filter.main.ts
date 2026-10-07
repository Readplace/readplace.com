import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbGmailConnection, initDynamoDbGmailCredentials, initDynamoDbGmailSender, initDynamoDbGmailDiscovery, initDynamoDbGmailHistoryImport, initDynamoDbGmailMapping, initDynamoDbInboxAddress } from "@packages/inbox-store";
import { requireEnv } from "@packages/require-env";
import {
	DisconnectGmailCommand,
	type GmailFilterRewriteFailedLine,
	GmailForwardingConfirmFailedEvent,
	GmailForwardingConfirmedEvent,
	RewriteGmailFilterCommand,
} from "@packages/hutch-infra-components";
import { initCancelGmailHistoryImports } from "./domain/gmail/cancel-gmail-history-imports";
import { initDisconnectGmail } from "./domain/gmail/disconnect-gmail";
import { initDisconnectGmailHandler } from "./domain/gmail/disconnect-gmail-handler";
import { initGmailForwardingConfirmFailedHandler } from "./domain/gmail/gmail-forwarding-confirm-failed-handler";
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

const addresses = initDynamoDbInboxAddress({
	client,
	tableName: requireEnv("DYNAMODB_INBOX_ADDRESSES_TABLE"),
	now,
});

const mappings = initDynamoDbGmailMapping({
	client,
	tableName: requireEnv("DYNAMODB_GMAIL_MAPPINGS_TABLE"),
	now,
});

const filterDeps = {
	filters: initGmailFilters({
		accessToken: initGmailAccessToken({
			clientId: requireEnv("GMAIL_INTEGRATION_CLIENT_ID"),
			clientSecret: requireEnv("GMAIL_INTEGRATION_CLIENT_SECRET"),
			credentials,
			fetch: globalThis.fetch,
			now,
			logger,
		}),
		fetch: globalThis.fetch,
	}),
	connections,
	addresses,
	now,
	logger,
};

const rewriteGmailFilter = initRewriteGmailFilter({ ...filterDeps, mappings });

const rewriteHandler = initRewriteGmailFilterHandler({
	rewriteGmailFilter,
	publishEvent,
	metricLog: HutchLogger.fromJSON<GmailFilterRewriteFailedLine>(),
	logger,
});

export const handler = initHandleByDetailType({
	routes: {
		[RewriteGmailFilterCommand.detailType]: [rewriteHandler],
		[GmailForwardingConfirmedEvent.detailType]: [
			initGmailForwardingConfirmedHandler({ connections, publishEvent, logger }),
		],
		[GmailForwardingConfirmFailedEvent.detailType]: [
			initGmailForwardingConfirmFailedHandler({ connections, now, logger }),
		],
		[DisconnectGmailCommand.detailType]: [
			initDisconnectGmailHandler({
				disconnectGmail: initDisconnectGmail({
					connections,
					credentials,
					senders,
					discovery: initDynamoDbGmailDiscovery({ client, tableName: requireEnv("DYNAMODB_GMAIL_DISCOVERY_TABLE"), now }),
					addresses,
					removeGmailFilter: initRewriteGmailFilter({ ...filterDeps, mappings: { listMappings: async () => [] } }),
					revokeGmailGrant: initRevokeGmailGrant({ fetch: globalThis.fetch }),
					cancelGmailHistoryImports: initCancelGmailHistoryImports({
						imports: initDynamoDbGmailHistoryImport({ client, tableName: requireEnv("DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE") }),
						now,
					}),
					logger,
				}),
				publishEvent,
				logger,
			}),
		],
	},
	logger,
});
