import assert from "node:assert/strict";
import { formatEnvMap } from "./env-map";
import { type DynamoTables, formatDynamoTables, parseDynamoTables } from "./dynamodb-tables";

const TABLES: DynamoTables = {
	articles: "hutch-articles",
	userArticles: "hutch-user-articles",
	users: "hutch-users",
	sessions: "hutch-sessions",
	oauth: "hutch-oauth",
	oauthOutcomes: "hutch-oauth-outcomes",
	verificationTokens: "hutch-verification-tokens",
	passwordResetTokens: "hutch-password-reset-tokens",
	browserHandoffCodes: "hutch-browser-handoff-codes",
	pendingSignups: "hutch-pending-signups",
	importSessions: "hutch-import-sessions",
	mediaUploadSessions: "hutch-media-upload-sessions",
	pendingViewHighlights: "hutch-pending-view-highlights",
	media: "hutch-media",
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
	it("reads every table name from the env map", () => {
		assert.deepEqual(parseDynamoTables(formatEnvMap(TABLES)), TABLES);
	});

	it("rejects a map missing a table", () => {
		const { gmailSenders: _gmailSenders, ...missing } = TABLES;
		assert.throws(() => parseDynamoTables(formatEnvMap(missing)), /gmailSenders/);
	});

	it("rejects a table the app does not read", () => {
		assert.throws(() => parseDynamoTables(formatEnvMap({ ...TABLES, staleTable: "hutch-stale" })), /staleTable/);
	});

	it("rejects an empty table name", () => {
		assert.throws(() => parseDynamoTables(formatEnvMap({ ...TABLES, users: "" })), /users/);
	});
});

describe("formatDynamoTables", () => {
	const STACK_TABLES: DynamoTables = {
		...TABLES,
		articles: "hutch-articles-staging",
		readerReadyNotifications: "hutch-reader-ready-notifications-staging",
	};

	it("writes the pattern and only the names that differ from it", () => {
		assert.equal(
			formatDynamoTables({
				tables: { articles: "hutch-articles-staging", users: "hutch-users" },
				namePattern: "hutch-*-staging",
			}),
			"*=hutch-*-staging,users=hutch-users",
		);
	});

	it("names a camel-cased table by its kebab-cased key", () => {
		assert.equal(
			formatDynamoTables({
				tables: { readerReadyNotifications: "hutch-reader-ready-notifications-staging" },
				namePattern: "hutch-*-staging",
			}),
			"*=hutch-*-staging",
		);
	});

	it("reads back every name it wrote, whether it follows the pattern or not", () => {
		assert.deepEqual(
			parseDynamoTables(formatDynamoTables({ tables: STACK_TABLES, namePattern: "hutch-*-staging" })),
			STACK_TABLES,
		);
	});

	it("still rejects a table the app does not read", () => {
		assert.throws(() => parseDynamoTables("*=hutch-*-staging,staleTable=hutch-stale"), /staleTable/);
	});

	it("still rejects an empty table name", () => {
		assert.throws(() => parseDynamoTables("*=hutch-*-staging,users="), /users/);
	});
});
