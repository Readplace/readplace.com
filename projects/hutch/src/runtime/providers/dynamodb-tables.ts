import { z } from "zod";

const TableName = z.string().min(1);

const DynamoTablesSchema = z.strictObject({
	articles: TableName,
	userArticles: TableName,
	users: TableName,
	sessions: TableName,
	oauth: TableName,
	oauthOutcomes: TableName,
	verificationTokens: TableName,
	passwordResetTokens: TableName,
	pendingSignups: TableName,
	importSessions: TableName,
	inboxAddresses: TableName,
	inboxEmailLinks: TableName,
	inboxSavedLinks: TableName,
	subscriptionProviders: TableName,
	onboarding: TableName,
	readerReadyNotifications: TableName,
	rateLimits: TableName,
	gmailDiscovery: TableName,
	gmailMonitoring: TableName,
	gmailCredentials: TableName,
	gmailConnections: TableName,
	gmailSenders: TableName,
	gmailMappings: TableName,
	gmailHistoryImports: TableName,
});

export type DynamoTables = z.infer<typeof DynamoTablesSchema>;

export function parseDynamoTables(json: string): DynamoTables {
	return DynamoTablesSchema.parse(JSON.parse(json));
}
