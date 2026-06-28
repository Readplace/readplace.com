import type { Handler } from "aws-lambda";
import express from "express";
import serverless from "serverless-http";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initBase } from "@packages/web-shell";
import { initGetSessionUserId, initResolveLogin } from "@packages/web-session";
import { initEmbedRoutes } from "./embed/embed.page";
import { getEnv, requireEnv } from "@packages/require-env";

const appOrigin = requireEnv("APP_ORIGIN");
const logger = HutchLogger.from(consoleLogger);

const base = initBase({
	staticBaseUrl: requireEnv("STATIC_BASE_URL"),
	liveReload: Boolean(getEnv("LIVERELOAD")),
});

const getSessionUserId = initGetSessionUserId({
	client: createDynamoDocumentClient(),
	sessionsTableName: requireEnv("DYNAMODB_SESSIONS_TABLE"),
});
const resolveLogin = initResolveLogin({ getSessionUserId, logger });

const app = express();
app.disable("x-powered-by");
app.use("/embed", initEmbedRoutes({ appOrigin, base, resolveLogin }));

export const handler: Handler = serverless(app);
