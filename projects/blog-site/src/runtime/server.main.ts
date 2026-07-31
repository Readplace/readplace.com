import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "@packages/domain/user";
import { MAX_PORT_ATTEMPTS, findAvailablePort } from "@packages/find-available-port";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { GlobalNav } from "@packages/web-shell";
import { initResolveLogin } from "@packages/web-session";
import { type AnalyticsEvent, isHttpsOrigin } from "@packages/web-analytics";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import { createBlogApp, PORT } from "./app";
import { getEnv, requireEnv } from "@packages/require-env";

const logger = HutchLogger.from(consoleLogger);

/** Local dev needs no AWS: an in-memory auth resolver (no sessions, so every
 * request resolves to guest); the production lambda wires the DynamoDB session
 * reader instead. */
const auth = initInMemoryAuth({ hashPassword, verifyPassword });
const resolveLogin = initResolveLogin({ getSessionUserId: auth.getSessionUserId, logger });

const app = createBlogApp(
	{
		staticBaseUrl: requireEnv("STATIC_BASE_URL"),
		liveReload: Boolean(getEnv("LIVERELOAD")),
		renderNav: GlobalNav,
	},
	{
		resolveLogin,
		analyticsLogger: HutchLogger.fromJSON<AnalyticsEvent>(),
		salt: requireEnv("ANALYTICS_SALT"),
		now: () => new Date(),
		generateVisitorId: randomUUID,
		secureCookies: isHttpsOrigin(requireEnv("APP_ORIGIN")),
		ownHost: new URL(requireEnv("APP_ORIGIN")).hostname,
	},
);

async function main(): Promise<void> {
	// Never fight another process for the port: a second checkout running its own
	// dev server would otherwise keep answering on it, and the browser would show
	// a running app serving that checkout's code. Nothing blog-site emits embeds
	// its own port (APP_ORIGIN is read for the cookie scheme only), so moving is
	// safe — at worst hutch's changelog banner, which points at the preferred
	// port, quietly falls back to its no-banner state.
	const port = await findAvailablePort({ preferredPort: PORT, maxAttempts: MAX_PORT_ATTEMPTS });
	app.listen(port).on("listening", () => {
		logger.info(`blog-site is running on http://localhost:${port}`);
	});
}

void main();
