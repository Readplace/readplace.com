import { randomUUID } from "node:crypto";
import type { Handler } from "aws-lambda";
import serverless from "serverless-http";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initBase, GlobalNav, HtmxOmitted } from "@packages/web-shell";
import { initGetSessionUserId, initResolveLogin } from "@packages/web-session";
import { type AnalyticsEvent, isHttpsOrigin } from "@packages/web-analytics";
import { createEmbedApp } from "./app";
import { getEnv, requireEnv } from "@packages/require-env";

const appOrigin = requireEnv("APP_ORIGIN");
const logger = HutchLogger.from(consoleLogger);

const base = initBase({
	staticBaseUrl: requireEnv("STATIC_BASE_URL"),
	liveReload: Boolean(getEnv("LIVERELOAD")),
	renderNav: GlobalNav,
	htmx: HtmxOmitted,
});

const getSessionUserId = initGetSessionUserId({
	client: createDynamoDocumentClient(),
	sessionsTableName: requireEnv("DYNAMODB_SESSIONS_TABLE"),
});
const resolveLogin = initResolveLogin({ getSessionUserId, logger });

const app = createEmbedApp({
	appOrigin,
	base,
	resolveLogin,
	analyticsLogger: HutchLogger.fromJSON<AnalyticsEvent>(),
	salt: requireEnv("ANALYTICS_SALT"),
	now: () => new Date(),
	generateVisitorId: randomUUID,
	secureCookies: isHttpsOrigin(appOrigin),
	ownHost: new URL(appOrigin).hostname,
	edgeSecret: requireEnv("SSR_EDGE_SECRET"),
});

export const handler: Handler = serverless(app);
