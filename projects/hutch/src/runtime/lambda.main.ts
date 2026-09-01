import type { Handler } from "aws-lambda";
import type { Request, Response } from "express";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import serverless from "serverless-http";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { logger as requestLogger } from "./domain/logger";
import { createAnalyticsMiddleware, hashIp } from "@packages/web-analytics";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import { isStaticAssetRequestPath } from "./web/static-asset-paths";
import { createBanMiddleware } from "./web/middleware/ban";
import { logAndRespondOnError } from "./web/middleware/error-handler";
import { createReadplaceApp, localServer } from "./app";
import { assertCurlImpersonateAvailable, defaultCurlImpersonateProbe } from "@packages/crawl-article";
import { getEnv, requireEnv } from "@packages/require-env";

const lambda = !!getEnv("AWS_LAMBDA_FUNCTION_NAME");

// createReadplaceApp builds initCrawlFetch (article/thumbnail crawls, stale-check
// refresh), whose last-resort leg spawns curl_chrome131. Fail cold start loudly
// if its layer is missing rather than leak per-URL ENOENTs. Lambda only — the
// dev server and E2E harness have no layer.
if (lambda) {
	assertCurlImpersonateAvailable({ probe: defaultCurlImpersonateProbe });
}

const { app, analyticsLogger } = createReadplaceApp();

const log = requestLogger();
const logger = HutchLogger.from(consoleLogger);
const salt = requireEnv("ANALYTICS_SALT");
const viewerIdentity = createViewerIdentityMiddleware({ edgeSecret: requireEnv("SSR_EDGE_SECRET") });
const ban = createBanMiddleware({ salt, hashIp });
const analytics = createAnalyticsMiddleware({
	logger: analyticsLogger,
	salt,
	now: () => new Date(),
	isStaticAssetPath: isStaticAssetRequestPath,
	ownHost: new URL(requireEnv("APP_ORIGIN")).hostname,
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
	.use(viewerIdentity)
	.use(ban)
	.use(analytics)
	.use(app)
	.use(logAndRespondOnError({ logger, now: () => new Date() }));

if (!lambda) {
	localServer(application, log);
}

export const handler: Handler = lambda ? serverless(application) : () => {};
