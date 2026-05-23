import type { Handler } from "aws-lambda";
import type { Request, Response } from "express";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import serverless from "serverless-http";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { logger as requestLogger } from "./domain/logger";
import { createAnalyticsMiddleware, hashIp } from "./web/middleware/analytics";
import { createBanMiddleware } from "./web/middleware/ban";
import { type BotBlockEvent, createBlockNaiveBotMiddleware } from "./web/middleware/naive-bot";
import { logAndRespondOnError } from "./web/middleware/error-handler";
import { createHutchApp, localServer } from "./app";
import { getEnv, requireEnv } from "./domain/require-env";

// present in Lambda runtime, absent locally — https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html#configuration-envvars-runtime
const lambda = !!getEnv("AWS_LAMBDA_FUNCTION_NAME");

const { app, analyticsLogger } = createHutchApp();

const log = requestLogger();
const logger = HutchLogger.from(consoleLogger);
const salt = requireEnv("ANALYTICS_SALT");
const ban = createBanMiddleware({ salt, hashIp });
const blockNaiveBot = createBlockNaiveBotMiddleware({
	logger: HutchLogger.fromJSON<BotBlockEvent>(),
});
const analytics = createAnalyticsMiddleware({
	logger: analyticsLogger,
	salt,
	now: () => new Date(),
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
	.use(ban)
	.use(blockNaiveBot)
	.use(analytics)
	.use(app)
	.use(logAndRespondOnError(logger));

if (!lambda) {
	localServer(application, log);
}

export const handler: Handler = lambda ? serverless(application) : () => {};
