import { createDynamoDocumentClient } from "@packages/storage-client";
import { EventBridgeClient, initEventBridgePublisher, initHandleByDetailType } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { initDynamoDbGmailConnection, initDynamoDbGmailCredentials, initDynamoDbGmailSender, initDynamoDbGmailDiscovery, initDynamoDbGmailHistoryImport, initDynamoDbGmailMapping, initDynamoDbGmailMonitoring, initDynamoDbInboxAddress } from "@packages/inbox-store";
import { readEnv } from "@packages/require-env";
import {
	DisconnectGmailCommand,
	type GmailFilterRewriteFailedLine,
	GmailForwardingConfirmFailedEvent,
	GmailForwardingConfirmedEvent,
	RewriteGmailFilterCommand,
} from "@packages/infra-components";
import { initCancelGmailHistoryImports } from "./domain/gmail/cancel-gmail-history-imports";
import { initDisconnectGmail } from "./domain/gmail/disconnect-gmail";
import { initDisconnectGmailWhenRequested } from "./domain/gmail/disconnect-gmail-when-requested";
import { initDisconnectGmailHandler } from "./domain/gmail/disconnect-gmail-handler";
import { initGmailForwardingConfirmFailedHandler } from "./domain/gmail/gmail-forwarding-confirm-failed-handler";
import { initGmailForwardingConfirmedHandler } from "./domain/gmail/gmail-forwarding-confirmed-handler";
import { initRewriteGmailFilter } from "./domain/gmail/rewrite-gmail-filter";
import { initRewriteGmailFilterHandler } from "./domain/gmail/rewrite-gmail-filter-handler";
import { initRewriteGmailFilterUnlessDisconnecting } from "./domain/gmail/rewrite-gmail-filter-unless-disconnecting";
import { initGmailAccessToken } from "./providers/gmail-api/gmail-access-token";
import { initGmailFilters } from "./providers/gmail-api/gmail-filters";
import { initRevokeGmailGrant } from "./providers/gmail-api/gmail-revoke";
import { REWRITE_GMAIL_FILTER_ENV } from "./rewrite-gmail-filter.env";

const env = readEnv(REWRITE_GMAIL_FILTER_ENV);

const logger = Logger.from(consoleLogger);
const client = createDynamoDocumentClient();
const now = () => new Date();

const credentials = initDynamoDbGmailCredentials({
	client,
	tableName: env.DYNAMODB_GMAIL_CREDENTIALS_TABLE,
	now,
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: env.EVENT_BUS_NAME,
});

const connections = initDynamoDbGmailConnection({
	client,
	tableName: env.DYNAMODB_GMAIL_CONNECTIONS_TABLE,
	now,
});

const senders = initDynamoDbGmailSender({
	client,
	tableName: env.DYNAMODB_GMAIL_SENDERS_TABLE,
	now,
});

const addresses = initDynamoDbInboxAddress({
	client,
	tableName: env.DYNAMODB_INBOX_ADDRESSES_TABLE,
	now,
});

const mappings = initDynamoDbGmailMapping({
	client,
	tableName: env.DYNAMODB_GMAIL_MAPPINGS_TABLE,
	now,
});

const filterDeps = {
	filters: initGmailFilters({
		accessToken: initGmailAccessToken({
			clientId: env.GMAIL_INTEGRATION_CLIENT_ID,
			clientSecret: env.GMAIL_INTEGRATION_CLIENT_SECRET,
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

const discovery = initDynamoDbGmailDiscovery({ client, tableName: env.DYNAMODB_GMAIL_DISCOVERY_TABLE, now });

const monitoring = initDynamoDbGmailMonitoring({ client, tableName: env.DYNAMODB_GMAIL_MONITORING_TABLE, now });

const historyImports = initDynamoDbGmailHistoryImport({ client, tableName: env.DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE });

const rewriteHandler = initRewriteGmailFilterHandler({
	rewriteGmailFilter: initRewriteGmailFilterUnlessDisconnecting({ connections, rewriteGmailFilter }),
	publishEvent,
	metricLog: Logger.fromJSON<GmailFilterRewriteFailedLine>(),
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
				disconnectGmail: initDisconnectGmailWhenRequested({
					connections,
					discovery,
					monitoring,
					disconnectGmail: initDisconnectGmail({
						connections,
						credentials,
						senders,
						discovery,
						monitoring,
						addresses,
						removeGmailFilter: initRewriteGmailFilter({ ...filterDeps, mappings: { listMappings: async () => [] } }),
						revokeGmailGrant: initRevokeGmailGrant({ fetch: globalThis.fetch }),
						cancelGmailHistoryImports: initCancelGmailHistoryImports({ imports: historyImports, now }),
						historyImports,
						logger,
					}),
				}),
				publishEvent,
				logger,
			}),
		],
	},
	logger,
});
