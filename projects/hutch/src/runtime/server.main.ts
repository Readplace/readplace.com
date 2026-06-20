import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createHutchApp } from "./app";
import { PORT } from "./server";

const logger = HutchLogger.from(consoleLogger);
const { app } = createHutchApp();

app.listen(PORT, () => {
	logger.info(`Server is running on http://localhost:${PORT}`);
});
