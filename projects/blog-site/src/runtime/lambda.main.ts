import type { Handler } from "aws-lambda";
import type { Request, Response } from "express";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import serverless from "serverless-http";
import { createBlogApp, PORT } from "./app";
import { getEnv, requireEnv } from "./require-env";

// present in Lambda runtime, absent locally — https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html#configuration-envvars-runtime
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
	.use(
		createBlogApp({
			staticBaseUrl: requireEnv("STATIC_BASE_URL"),
			liveReload: Boolean(getEnv("LIVERELOAD")),
		}),
	);

if (!lambda) {
	application.listen(PORT, () => {
		console.log(`blog-site is running on http://localhost:${PORT}`);
	});
}

export const handler: Handler = lambda ? serverless(application) : () => {};
