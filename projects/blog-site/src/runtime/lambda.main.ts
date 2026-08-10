import { randomUUID } from "node:crypto";
import type { Handler } from "aws-lambda";
import type { Request, Response } from "express";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { GlobalNav, HtmxOmitted } from "@packages/web-shell";
import { initGetSessionUserId, initResolveLogin } from "@packages/web-session";
import { type AnalyticsEvent, isHttpsOrigin } from "@packages/web-analytics";
import serverless from "serverless-http";
import { createBlogApp, PORT } from "./app";
import { getEnv, requireEnv } from "@packages/require-env";

const lambda = !!getEnv("AWS_LAMBDA_FUNCTION_NAME");

const logger = HutchLogger.from(consoleLogger);

const getSessionUserId = initGetSessionUserId({
	client: createDynamoDocumentClient(),
	sessionsTableName: requireEnv("DYNAMODB_SESSIONS_TABLE"),
});
const resolveLogin = initResolveLogin({ getSessionUserId, logger });

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
		createBlogApp(
			{
				staticBaseUrl: requireEnv("STATIC_BASE_URL"),
				liveReload: Boolean(getEnv("LIVERELOAD")),
				renderNav: GlobalNav,
				htmx: HtmxOmitted,
			},
			{
				resolveLogin,
				analyticsLogger: HutchLogger.fromJSON<AnalyticsEvent>(),
				salt: requireEnv("ANALYTICS_SALT"),
				now: () => new Date(),
				generateVisitorId: randomUUID,
				// APP_ORIGIN carries the scheme the blog is served on; only that scheme
				// is consumed (isHttpsOrigin) to decide Secure cookies.
				secureCookies: isHttpsOrigin(requireEnv("APP_ORIGIN")),
				// The blog is served under the app's own host (readplace.com/blog), so
				// its analytics gate reads the same origin.
				ownHost: new URL(requireEnv("APP_ORIGIN")).hostname,
			},
		),
	);

if (!lambda) {
	application.listen(PORT).on("listening", () => {
		logger.info(`blog-site is running on http://localhost:${PORT}`);
	});
}

export const handler: Handler = lambda ? serverless(application) : () => {};
