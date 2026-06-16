import type { Handler } from "aws-lambda";
import assert from "node:assert";
import express from "express";
import serverless from "serverless-http";
import { initEmbedRoutes } from "./embed/embed.page";

const appOrigin = process.env.APP_ORIGIN;
assert(appOrigin, "APP_ORIGIN is required");

const app = express();
app.disable("x-powered-by");
app.use("/embed", initEmbedRoutes({ appOrigin }));

export const handler: Handler = serverless(app);
