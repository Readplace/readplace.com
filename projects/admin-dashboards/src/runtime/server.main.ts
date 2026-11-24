import assert from "node:assert";
import { randomUUID } from "node:crypto";
import express from "express";
import { hashPassword, verifyPassword } from "@packages/domain/user";
import { Logger, consoleLogger } from "@packages/logger";
import { initBase, GlobalNav, HtmxLoaded } from "@packages/web-shell";
import { SESSION_COOKIE_NAME, initResolveLogin } from "@packages/web-session";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import { initInMemoryLogsInsights } from "@packages/test-fixtures/providers/logs-insights";
import type { AnalyticsEvent } from "@packages/web-analytics";
import { ANALYTICS_LOG_GROUP, AUTH_DIAGNOSTICS_LOG_GROUP, buildAdminDashboards } from "@packages/dashboard-widgets";
import { requireEnv } from "@packages/require-env";
import { READY_NONCE_ENV, readyProbePath } from "@packages/e2e-harness/ready-probe";
import { createAdminDashboardsApp } from "./app";
import { initAdminDashboardResults } from "./dashboards/admin-dashboard-results";
import { E2E_DASHBOARDS_NOW, e2eDashboardAnswers } from "../e2e/admin-dashboards/admin-dashboards-fixture";

const PORT = Number(requireEnv("E2E_PORT"));
const appOrigin = `http://127.0.0.1:${PORT}`;
const logger = Logger.from(consoleLogger);
const ADMIN_EMAIL = "ops@readplace.com";

const base = initBase({
	staticBaseUrl: "",
	liveReload: false,
	renderNav: GlobalNav,
	htmx: HtmxLoaded,
});
const auth = initInMemoryAuth({ hashPassword, verifyPassword, now: () => new Date() });
const resolveLogin = initResolveLogin({ getSessionUserId: auth.getSessionUserId, logger });
const logsInsights = initInMemoryLogsInsights();
for (const answer of e2eDashboardAnswers()) logsInsights.answerQuery(answer);

const adminUserId = auth.createUser({ email: ADMIN_EMAIL, password: randomUUID() }).then((created) => {
	assert(created.ok, "the e2e server creates its one admin before it serves");
	return created.userId;
});
let adminTotpStep = Math.floor(E2E_DASHBOARDS_NOW.getTime() / 1000);

const app = express();
app.disable("x-powered-by");

app.get(readyProbePath(requireEnv(READY_NONCE_ENV)), (_req, res) => {
	res.status(200).end();
});

app.get("/client-dist/htmx.client.js", (_req, res) => {
	res.sendFile(require.resolve("htmx.org/dist/htmx.js"), { dotfiles: "allow" });
});

app.post("/e2e/admin-session", async (_req, res) => {
	const sessionId = await auth.createSession({ userId: await adminUserId, emailVerified: true });
	adminTotpStep += 1;
	const marked = await auth.markSessionAdminMfaVerified({
		sessionId,
		at: Math.floor(E2E_DASHBOARDS_NOW.getTime() / 1000),
		email: ADMIN_EMAIL,
		totpStep: adminTotpStep,
	});
	if (marked.kind !== "verified") {
		res.sendStatus(500);
		return;
	}
	res.cookie(SESSION_COOKIE_NAME, sessionId, { httpOnly: true, sameSite: "lax", path: "/" });
	res.sendStatus(204);
});

app.use(
	createAdminDashboardsApp({
		base,
		resolveLogin,
		findUserByEmail: auth.findUserByEmail,
		findSessionAdminMfaVerifiedAt: auth.findSessionAdminMfaVerifiedAt,
		adminEmails: [ADMIN_EMAIL],
		dashboards: buildAdminDashboards({
			analyticsLogGroupName: ANALYTICS_LOG_GROUP,
			authDiagnosticsLogGroupName: AUTH_DIAGNOSTICS_LOG_GROUP,
		}),
		runLogsInsightsQuery: logsInsights.runLogsInsightsQuery,
		readExcludedIdentities: async () => ({ excludedVisitorIds: [], excludedUserIds: [] }),
		...initAdminDashboardResults(),
		analyticsLogger: Logger.fromJSON<AnalyticsEvent>(),
		logger,
		salt: requireEnv("ANALYTICS_SALT"),
		now: () => E2E_DASHBOARDS_NOW,
		generateVisitorId: randomUUID,
		secureCookies: false,
		ownHost: new URL(appOrigin).hostname,
		edgeSecret: requireEnv("SSR_EDGE_SECRET"),
	}),
);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

app.listen(PORT, "127.0.0.1");
