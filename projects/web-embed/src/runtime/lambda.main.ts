import type { Handler } from "aws-lambda";
import express from "express";
import serverless from "serverless-http";
import { initEmbedRoutes } from "./embed/embed.page";
import { requireEnv } from "@packages/require-env";

const appOrigin = requireEnv("APP_ORIGIN");

const app = express();
app.disable("x-powered-by");
app.use("/embed", initEmbedRoutes({ appOrigin }));

export const handler: Handler = serverless(app);
