import express from "express";
import { hashPassword, verifyPassword } from "@packages/domain/user";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initBase, GlobalNav } from "@packages/web-shell";
import { initResolveLogin } from "@packages/web-session";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import { initEmbedRoutes } from "./embed/embed.page";
import { requireEnv } from "@packages/require-env";
import { READY_NONCE_ENV, readyProbePath } from "@packages/e2e-harness/ready-probe";

const PORT = Number(requireEnv("E2E_PORT"));
const appOrigin = `http://localhost:${PORT}`;
const logger = HutchLogger.from(consoleLogger);

/** Local/e2e composition root needs no AWS: the shell renders against an empty
 * static-asset origin (favicons/fonts are irrelevant to the snippet rendering
 * the visual tests assert) and an in-memory auth resolver (no sessions, so every
 * request resolves to guest). */
const base = initBase({ staticBaseUrl: "", liveReload: false, renderNav: GlobalNav });
const auth = initInMemoryAuth({ hashPassword, verifyPassword });
const resolveLogin = initResolveLogin({ getSessionUserId: auth.getSessionUserId, logger });

const app = express();
app.disable("x-powered-by");

app.get(readyProbePath(requireEnv(READY_NONCE_ENV)), (_req, res) => {
	res.status(200).end();
});

app.use("/embed", initEmbedRoutes({ appOrigin, base, resolveLogin }));

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

app.listen(PORT);
