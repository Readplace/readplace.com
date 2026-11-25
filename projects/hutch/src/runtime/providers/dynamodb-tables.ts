import { z } from "zod";
import { formatEnvMap, parseEnvMap } from "./env-map";

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
	browserHandoffCodes: TableName,
	pendingSignups: TableName,
	importSessions: TableName,
	mediaUploadSessions: TableName,
	pendingViewHighlights: TableName,
	media: TableName,
	inboxAddresses: TableName,
	inboxEmails: TableName,
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
	canaryReports: TableName,
});

export type DynamoTables = z.infer<typeof DynamoTablesSchema>;

const NAME_PATTERN_KEY = "*";

const TABLE_KEYS = DynamoTablesSchema.keyof().options;

function nameFromPattern(input: { key: string; namePattern: string }): string {
	const kebabKey = input.key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
	return input.namePattern.replace(NAME_PATTERN_KEY, kebabKey);
}

export function formatDynamoTables(input: { tables: Record<string, string>; namePattern: string }): string {
	const differing = Object.entries(input.tables).filter(
		([key, name]) => name !== nameFromPattern({ key, namePattern: input.namePattern }),
	);
	return formatEnvMap({ [NAME_PATTERN_KEY]: input.namePattern, ...Object.fromEntries(differing) });
}

export function parseDynamoTables(raw: string): DynamoTables {
	const { [NAME_PATTERN_KEY]: namePattern, ...named } = parseEnvMap(raw);
	const fromPattern =
		namePattern === undefined
			? {}
			: Object.fromEntries(TABLE_KEYS.map((key) => [key, nameFromPattern({ key, namePattern })]));
	return DynamoTablesSchema.parse({ ...fromPattern, ...named });
}
