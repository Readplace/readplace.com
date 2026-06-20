import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createBlogApp, PORT } from "./app";
import { getEnv, requireEnv } from "./require-env";

const logger = HutchLogger.from(consoleLogger);

const app = createBlogApp({
	staticBaseUrl: requireEnv("STATIC_BASE_URL"),
	liveReload: Boolean(getEnv("LIVERELOAD")),
});

app.listen(PORT, () => {
	logger.info(`blog-site is running on http://localhost:${PORT}`);
});
