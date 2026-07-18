import { MAX_PORT_ATTEMPTS, findAvailablePort } from "@packages/find-available-port";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { requireEnv } from "@packages/require-env";
import { createHutchApp } from "./app";
import { PORT } from "./server";

const logger = HutchLogger.from(consoleLogger);

async function main(): Promise<void> {
	// Never fight another process for the port: a second checkout running its own
	// dev server would otherwise keep answering on it, and the browser would show
	// a running app serving that checkout's code.
	const port = await findAvailablePort({
		preferredPort: Number.parseInt(PORT, 10),
		maxAttempts: MAX_PORT_ATTEMPTS,
	});
	// Correct the configured origin to the port actually bound. Nearly everything
	// hutch hands a client is an absolute URL built from this origin — OAuth
	// `redirect_uri`, the CORS allow-list (an exact string compare), Stripe return
	// URLs, upload slots, sitemap entries — so an origin still naming the
	// preferred port would send those clients to whatever else holds it: the very
	// server we stepped aside from. Only the port is replaced, so a proxied scheme
	// or host in the configured origin survives.
	const appOrigin = new URL(requireEnv("APP_ORIGIN"));
	appOrigin.port = String(port);

	const { app } = createHutchApp({ appOrigin: appOrigin.origin });
	app.listen(port, () => {
		logger.info(`Server is running on ${appOrigin.origin}`);
	});
}

void main();
