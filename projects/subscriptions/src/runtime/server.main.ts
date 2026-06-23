import express from "express";
import { initHealthRoutes } from "./health/health.page";
import { requireEnv } from "./require-env";

const PORT = Number(requireEnv("SUBSCRIPTIONS_PORT"));

const app = express();
app.disable("x-powered-by");
app.use("/subscriptions", initHealthRoutes());

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

app.listen(PORT);
