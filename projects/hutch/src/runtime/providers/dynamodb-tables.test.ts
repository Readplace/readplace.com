import assert from "node:assert/strict";
import { type DynamoTables, parseDynamoTables } from "./dynamodb-tables";

const TABLES: DynamoTables = {
	articles: "hutch-articles",
	userArticles: "hutch-user-articles",
	users: "hutch-users",
	sessions: "hutch-sessions",
	oauth: "hutch-oauth",
	oauthOutcomes: "hutch-oauth-outcomes",
	verificationTokens: "hutch-verification-tokens",
	passwordResetTokens: "hutch-password-reset-tokens",
	pendingSignups: "hutch-pending-signups",
	importSessions: "hutch-import-sessions",
	inboxAddresses: "hutch-inbox-addresses",
	inboxEmailLinks: "hutch-inbox-email-links",
	inboxSavedLinks: "hutch-inbox-saved-links",
	subscriptionProviders: "hutch-subscription-providers",
	onboarding: "hutch-onboarding",
	readerReadyNotifications: "hutch-reader-ready-notifications",
	rateLimits: "hutch-rate-limits",
	gmailDiscovery: "hutch-gmail-discovery",
	gmailMonitoring: "hutch-gmail-monitoring",
	gmailCredentials: "hutch-gmail-credentials",
	gmailConnections: "hutch-gmail-connections",
	gmailSenders: "hutch-gmail-senders",
	gmailMappings: "hutch-gmail-mappings",
	gmailHistoryImports: "hutch-gmail-history-imports",
	canaryReports: "hutch-canary-reports",
};

describe("parseDynamoTables", () => {
	it("reads every table name from the JSON map", () => {
		assert.deepEqual(parseDynamoTables(JSON.stringify(TABLES)), TABLES);
	});

	it("rejects a map missing a table", () => {
		const { gmailSenders: _gmailSenders, ...missing } = TABLES;
		assert.throws(() => parseDynamoTables(JSON.stringify(missing)), /gmailSenders/);
	});

	it("rejects a table the app does not read", () => {
		assert.throws(() => parseDynamoTables(JSON.stringify({ ...TABLES, staleTable: "hutch-stale" })), /staleTable/);
	});

	it("rejects an empty table name", () => {
		assert.throws(() => parseDynamoTables(JSON.stringify({ ...TABLES, users: "" })), /users/);
	});
});
