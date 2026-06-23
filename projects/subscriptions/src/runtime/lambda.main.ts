import type { Handler } from "aws-lambda";
import express from "express";
import serverless from "serverless-http";
import { initHealthRoutes } from "./health/health.page";

const app = express();
app.disable("x-powered-by");
app.use("/subscriptions", initHealthRoutes());

export const handler: Handler = serverless(app);
