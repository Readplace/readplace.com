import { hashPassword, verifyPassword } from "@packages/domain/user";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initResolveLogin } from "@packages/web-session";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import { createBlogApp, PORT } from "./app";
import { getEnv, requireEnv } from "@packages/require-env";

const logger = HutchLogger.from(consoleLogger);

/** Local dev needs no AWS: an in-memory auth resolver (no sessions, so every
 * request resolves to guest) mirrors hutch's composition-root persistence
 * selection — the production lambda wires the DynamoDB session reader instead. */
const auth = initInMemoryAuth({ hashPassword, verifyPassword });
const resolveLogin = initResolveLogin({ getSessionUserId: auth.getSessionUserId, logger });

const app = createBlogApp(
	{
		staticBaseUrl: requireEnv("STATIC_BASE_URL"),
		liveReload: Boolean(getEnv("LIVERELOAD")),
	},
	{ resolveLogin },
);

app.listen(PORT, () => {
	logger.info(`blog-site is running on http://localhost:${PORT}`);
});
