import { randomUUID } from "node:crypto";
import type { Handler } from "aws-lambda";
import serverless from "serverless-http";
import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initBase, GlobalNav, HtmxOmitted } from "@packages/web-shell";
import { initResolveWebsiteLogin } from "@packages/web-session";
import { type AnalyticsEvent, isHttpsOrigin } from "@packages/web-analytics";
import { createEmbedApp } from "./app";
import { getEnv, requireEnv } from "@packages/require-env";

const appOrigin = requireEnv("APP_ORIGIN");
const logger = Logger.from(consoleLogger);

const base = initBase({
	staticBaseUrl: requireEnv("STATIC_BASE_URL"),
	liveReload: Boolean(getEnv("LIVERELOAD")),
	renderNav: GlobalNav,
	htmx: HtmxOmitted,
});

const resolveLogin = initResolveWebsiteLogin({
	client: createDynamoDocumentClient(),
	sessionsTableName: requireEnv("DYNAMODB_SESSIONS_TABLE"),
	salt: requireEnv("ANALYTICS_SALT"),
	now: () => new Date(),
	logger,
	journalLogger: Logger.fromJSON<Record<string, unknown>>(),
});

const app = createEmbedApp({
	appOrigin,
	base,
	resolveLogin,
	analyticsLogger: Logger.fromJSON<AnalyticsEvent>(),
	salt: requireEnv("ANALYTICS_SALT"),
	now: () => new Date(),
	generateVisitorId: randomUUID,
	secureCookies: isHttpsOrigin(appOrigin),
	ownHost: new URL(appOrigin).hostname,
	edgeSecret: requireEnv("SSR_EDGE_SECRET"),
});

export const handler: Handler = serverless(app);
