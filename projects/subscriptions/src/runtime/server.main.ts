import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { requireEnv } from "@packages/require-env";
import { createSubscriptionsApp } from "./app";

const logger = HutchLogger.from(consoleLogger);
const port = Number(requireEnv("SUBSCRIPTIONS_PORT"));

const app = createSubscriptionsApp();
app.listen(port).on("listening", () => {
	logger.info(`subscriptions is running on http://localhost:${port}`);
});
