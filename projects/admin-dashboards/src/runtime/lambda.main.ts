import { randomUUID } from "node:crypto";
import type { Handler } from "aws-lambda";
import serverless from "serverless-http";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { SSMClient } from "@aws-sdk/client-ssm";
import { Logger, consoleLogger } from "@packages/logger";
import { createDynamoDocumentClient } from "@packages/storage-client";
import { initBase, GlobalNav, HtmxLoaded } from "@packages/web-shell";
import { initResolveWebsiteLogin } from "@packages/web-session";
import { type AnalyticsEvent, isHttpsOrigin } from "@packages/web-analytics";
import { parseAdminEmails } from "@packages/admin-gate";
import {
	ANALYTICS_LOG_GROUP,
	AUTH_DIAGNOSTICS_LOG_GROUP,
	EXCLUDED_IDENTITIES_PARAMETER_NAME,
	buildAdminDashboards,
	parseExcludedIdentities,
} from "@packages/dashboard-widgets";
import { readEnv } from "@packages/require-env";
import { createAdminDashboardsApp } from "./app";
import { initAdminDashboardResults } from "./dashboards/admin-dashboard-results";
import { ADMIN_DASHBOARDS_ENV } from "./lambda.env";
import { initDynamoDbAdminAccess } from "./providers/admin-access/dynamodb-admin-access";
import { initSsmExcludedIdentities } from "./providers/excluded-identities/ssm-excluded-identities";
import { initCloudWatchLogsInsights } from "./providers/logs-insights/cloudwatch-logs-insights";

const env = readEnv(ADMIN_DASHBOARDS_ENV);
const logger = Logger.from(consoleLogger);
const dynamoClient = createDynamoDocumentClient();
const logsClient = new CloudWatchLogsClient({});
const ssmClient = new SSMClient({});

const base = initBase({
	staticBaseUrl: env.STATIC_BASE_URL,
	liveReload: false,
	renderNav: GlobalNav,
	htmx: HtmxLoaded,
});

const resolveLogin = initResolveWebsiteLogin({
	client: dynamoClient,
	sessionsTableName: env.DYNAMODB_SESSIONS_TABLE,
	salt: env.ANALYTICS_SALT,
	now: () => new Date(),
	logger,
	journalLogger: Logger.fromJSON<Record<string, unknown>>(),
});

const adminAccess = initDynamoDbAdminAccess({
	client: dynamoClient,
	usersTableName: env.DYNAMODB_USERS_TABLE,
	sessionsTableName: env.DYNAMODB_SESSIONS_TABLE,
});

const app = createAdminDashboardsApp({
	base,
	resolveLogin,
	findUserByEmail: adminAccess.findUserByEmail,
	findSessionAdminMfaVerifiedAt: adminAccess.findSessionAdminMfaVerifiedAt,
	adminEmails: parseAdminEmails(env.ADMIN_EMAILS),
	dashboards: buildAdminDashboards({
		analyticsLogGroupName: ANALYTICS_LOG_GROUP,
		authDiagnosticsLogGroupName: AUTH_DIAGNOSTICS_LOG_GROUP,
	}),
	runLogsInsightsQuery: initCloudWatchLogsInsights({
		startQuery: (command) => logsClient.send(command),
		getQueryResults: (command) => logsClient.send(command),
		stopQuery: (command) => logsClient.send(command),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		now: () => Date.now(),
		pollIntervalMs: 1000,
		maxWaitMs: 25_000,
	}),
	readExcludedIdentities: initSsmExcludedIdentities({
		getParameter: (command) => ssmClient.send(command),
		parameterName: EXCLUDED_IDENTITIES_PARAMETER_NAME,
		parseExcludedIdentities,
	}),
	...initAdminDashboardResults(),
	analyticsLogger: Logger.fromJSON<AnalyticsEvent>(),
	logger,
	salt: env.ANALYTICS_SALT,
	now: () => new Date(),
	generateVisitorId: randomUUID,
	secureCookies: isHttpsOrigin(env.APP_ORIGIN),
	ownHost: new URL(env.APP_ORIGIN).hostname,
	edgeSecret: env.SSR_EDGE_SECRET,
});

export const handler: Handler = serverless(app);
