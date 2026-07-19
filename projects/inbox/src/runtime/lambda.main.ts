import type { Handler } from "aws-lambda";
import type { Request, Response } from "express";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import serverless from "serverless-http";
import { S3Client } from "@aws-sdk/client-s3";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initGetSessionUserId, initResolveLogin } from "@packages/web-session";
import {
	initDynamoDbInboxAddress,
	initDynamoDbInboxEmail,
	initDynamoDbInboxEmailLink,
} from "@packages/inbox-store";
import { initS3ReadContent } from "@packages/article-store";
import { SubmitLinkCommand } from "@packages/hutch-infra-components";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import { getEnv, requireEnv } from "@packages/require-env";
import { createInboxApp, PORT } from "./app";
import { initDynamoDbUserStanding } from "./providers/user-standing/dynamodb-user-standing";
import { initChangelogBannerSource } from "./web/changelog-banner-source";

const lambda = !!getEnv("AWS_LAMBDA_FUNCTION_NAME");

const logger = HutchLogger.from(consoleLogger);

const client = createDynamoDocumentClient();
const s3Client = new S3Client({});

const sessionsTableName = requireEnv("DYNAMODB_SESSIONS_TABLE");

const getSessionUserId = initGetSessionUserId({ client, sessionsTableName });
const resolveLogin = initResolveLogin({ getSessionUserId, logger });

const userStanding = initDynamoDbUserStanding({
	client,
	tableNames: {
		users: requireEnv("DYNAMODB_USERS_TABLE"),
		sessions: sessionsTableName,
	},
});

const subscriptionRead = initDynamoDbSubscriptionRead({
	client,
	tableName: requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE"),
});

const { publishEvent } = initEventBridgePublisher({
	client: new EventBridgeClient({}),
	eventBusName: requireEnv("EVENT_BUS_NAME"),
});

const readEmailContent = initS3ReadContent({
	send: (cmd) => s3Client.send(cmd),
	bucketName: requireEnv("CONTENT_BUCKET_NAME"),
});

const { getChangelogBanner } = initChangelogBannerSource({
	fetch: globalThis.fetch,
	sourceUrl: requireEnv("CHANGELOG_BANNER_URL"),
	now: () => Date.now(),
	ttlMs: 300_000,
	timeoutMs: 800,
	logger,
});

const application = express()
	.disable("x-powered-by")
	.use(helmet({ contentSecurityPolicy: false }))
	.use(
		compression({
			filter: (req: Request, res: Response) =>
				lambda ? compression.filter(req, res) : false,
		}),
	)
	.use(
		createInboxApp(
			{
				inboxAddressDomain: requireEnv("INBOX_ADDRESS_DOMAIN"),
				imagesCdnBaseUrl: requireEnv("IMAGES_CDN_BASE_URL"),
			},
			{
				resolveLogin,
				findUserById: userStanding.findUserById,
				markSessionEmailVerified: userStanding.markSessionEmailVerified,
				findSubscriptionByUserId: subscriptionRead.findByUserId,
				getChangelogBanner,
				inboxAddressStore: initDynamoDbInboxAddress({
					client,
					tableName: requireEnv("DYNAMODB_INBOX_ADDRESSES_TABLE"),
					now: () => new Date(),
				}),
				inboxEmailStore: initDynamoDbInboxEmail({
					client,
					tableName: requireEnv("DYNAMODB_INBOX_EMAILS_TABLE"),
				}),
				inboxEmailLinkStore: initDynamoDbInboxEmailLink({
					client,
					tableName: requireEnv("DYNAMODB_INBOX_EMAIL_LINKS_TABLE"),
				}),
				readEmailContent,
				publishSubmitLink: (input) => publishEvent(SubmitLinkCommand, input),
				logError: (message, error) => logger.error(message, { error }),
				now: () => new Date(),
			},
		),
	);

if (!lambda) {
	application.listen(PORT, () => {
		logger.info(`inbox is running on http://localhost:${PORT}`);
	});
}

export const handler: Handler = lambda ? serverless(application) : () => {};
