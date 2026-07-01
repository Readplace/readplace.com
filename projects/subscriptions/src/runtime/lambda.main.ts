import type { Handler } from "aws-lambda";
import type { Request, Response } from "express";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import serverless from "serverless-http";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { getEnv, requireEnv } from "@packages/require-env";
import { createSubscriptionsApp } from "./app";

const lambda = !!getEnv("AWS_LAMBDA_FUNCTION_NAME");

const application = express()
	.disable("x-powered-by")
	.use(helmet({ contentSecurityPolicy: false }))
	.use(
		compression({
			filter: (req: Request, res: Response) =>
				lambda ? compression.filter(req, res) : false,
		}),
	)
	.use(createSubscriptionsApp());

if (!lambda) {
	const logger = HutchLogger.from(consoleLogger);
	const port = Number(requireEnv("SUBSCRIPTIONS_PORT"));
	application.listen(port, () => {
		logger.info(`subscriptions is running on http://localhost:${port}`);
	});
}

export const handler: Handler = lambda ? serverless(application) : () => {};
