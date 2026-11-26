import { consoleLogger, Logger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { initDeliverIssueMatches } from "./domain/inbox/deliver-issue-matches";
import { initDynamoDbEmailImportCompletion, initDynamoDbInboxEmail, initDynamoDbInboxEmailLink } from "@packages/inbox-store";
import { readEnv } from "@packages/require-env";
import { RECORD_EMAIL_LINKS_FILTERED_ENV } from "./record-email-links-filtered.env";
import { initRecordEmailLinksFilteredHandler } from "./domain/inbox/record-email-links-filtered-handler";

const env = readEnv(RECORD_EMAIL_LINKS_FILTERED_ENV);

const client = createDynamoDocumentClient();
const emails = { client, tableName: env.DYNAMODB_INBOX_EMAILS_TABLE };
const { findCompletion, amendSelection } = initDynamoDbEmailImportCompletion(emails);
const { getEmail } = initDynamoDbInboxEmail(emails);
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: env.EVENT_BUS_NAME });

const logger = Logger.from(consoleLogger);
const inboxEmailLinkStore = initDynamoDbInboxEmailLink({
	client,
	tableName: env.DYNAMODB_INBOX_EMAIL_LINKS_TABLE,
});

export const handler = initRecordEmailLinksFilteredHandler({
	putReadlistOutcome: inboxEmailLinkStore.putReadlistOutcome,
	mergeReadlistOutcomeFit: inboxEmailLinkStore.mergeReadlistOutcomeFit,
	listLinksByEmail: inboxEmailLinkStore.listLinksByEmail,
	deliverIssueMatches: initDeliverIssueMatches({ findCompletion, amendSelection, getEmail, getLink: inboxEmailLinkStore.getLink, publishEvent }),
	logger,
});
