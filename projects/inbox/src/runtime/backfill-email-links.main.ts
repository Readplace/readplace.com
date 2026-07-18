/**
 * One-shot manual backfill: re-run link extraction for every received email so
 * the CURRENT skip/triage classification (ESP action-link shapes,
 * List-Unsubscribe matches, LLM triage, the Skipped tab) applies to mail
 * that predates it. Per email: delete its link rows + meta barrier, then
 * re-publish `EmailReceivedEvent` — the DEPLOYED extraction consumer re-derives
 * everything through the same code a fresh receive runs, including the
 * preview-crawl fan-out (existing crawled previews are re-crawled).
 *
 * Run manually (no package.json command) after `pnpm nx run inbox:compile`:
 *
 *   source .env
 *   AWS_PROFILE=hutch-production AWS_REGION=ap-southeast-2 \
 *   DYNAMODB_INBOX_EMAILS_TABLE=hutch-inbox-emails-prod \
 *   DYNAMODB_INBOX_EMAIL_LINKS_TABLE=hutch-inbox-email-links-prod \
 *   EVENT_BUS_NAME=<prod bus name> \
 *   DRY_RUN=true \
 *   node projects/inbox/dist/runtime/backfill-email-links.main.js
 *
 * Optional: BACKFILL_USER_ID=<userId> limits the run to one user (staged
 * rollout). Drop DRY_RUN for the real run. Re-runnable: the delete is
 * idempotent and the extraction consumer handles replays.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { EmailReceivedEvent } from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient, defineDynamoTable } from "@packages/hutch-storage-client";
import { initDynamoDbInboxEmailLink } from "@packages/inbox-store";
import { getEnv, requireEnv } from "@packages/require-env";
import {
	BackfillLinksRowSchema,
	initBackfillEmailLinks,
} from "./domain/inbox/backfill-email-links";

const SLEEP_BETWEEN_ROWS_MS = 2_000;

const inboxEmailsTable = requireEnv("DYNAMODB_INBOX_EMAILS_TABLE");
const inboxEmailLinksTable = requireEnv("DYNAMODB_INBOX_EMAIL_LINKS_TABLE");
const eventBusName = requireEnv("EVENT_BUS_NAME");
const dryRun = getEnv("DRY_RUN") === "true";
const onlyUserId = getEnv("BACKFILL_USER_ID");

const dynamoClient = createDynamoDocumentClient();
const logger = HutchLogger.from(consoleLogger);
const table = defineDynamoTable({
	client: dynamoClient,
	tableName: inboxEmailsTable,
	schema: BackfillLinksRowSchema,
});
const inboxEmailLinkStore = initDynamoDbInboxEmailLink({
	client: dynamoClient,
	tableName: inboxEmailLinksTable,
});
const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName,
});

const runBackfill = initBackfillEmailLinks({
	scanEmailRowPages: async function* () {
		let lastEvaluatedKey: Record<string, unknown> | undefined;
		do {
			const page = await table.scan({
				ProjectionExpression: "userId, receivedAtMessageId, #status, recipientAddress",
				ExpressionAttributeNames: { "#status": "status" },
				ExclusiveStartKey: lastEvaluatedKey,
			});
			yield page.items;
			lastEvaluatedKey = page.lastEvaluatedKey;
		} while (lastEvaluatedKey !== undefined);
	},
	deleteEmailLinks: inboxEmailLinkStore.deleteLinksByEmail,
	publishEmailReceived: (input) => publishEvent(EmailReceivedEvent, input),
	logger,
	dryRun,
	onlyUserId,
	receivedBefore: new Date().toISOString(),
	sleepBetweenRows: () => sleep(SLEEP_BETWEEN_ROWS_MS),
});

runBackfill()
	.then((tally) => {
		logger.info("[backfill-email-links] finished", { dryRun, tally });
	})
	.catch((error) => {
		logger.error("[backfill-email-links] aborted", { error });
		process.exitCode = 1;
	});
