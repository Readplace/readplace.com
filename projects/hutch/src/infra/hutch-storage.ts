import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export class HutchStorage extends pulumi.ComponentResource {
	public readonly articlesTable: aws.dynamodb.Table;
	public readonly userArticlesTable: aws.dynamodb.Table;
	public readonly usersTable: aws.dynamodb.Table;
	public readonly sessionsTable: aws.dynamodb.Table;
	public readonly oauthTable: aws.dynamodb.Table;
	public readonly verificationTokensTable: aws.dynamodb.Table;
	public readonly passwordResetTokensTable: aws.dynamodb.Table;
	public readonly pendingSignupsTable: aws.dynamodb.Table;
	public readonly importSessionsTable: aws.dynamodb.Table;
	public readonly subscriptionProvidersTable: aws.dynamodb.Table;

	constructor(name: string, args: { deletionProtection: boolean; tableNames: {
		articles: string;
		userArticles: string;
		users: string;
		sessions: string;
		oauth: string;
		verificationTokens: string;
		passwordResetTokens: string;
		pendingSignups: string;
		importSessions: string;
		subscriptionProviders: string;
	} }, opts?: pulumi.ComponentResourceOptions) {
		super("hutch:infra:HutchStorage", name, {}, opts);

		this.articlesTable = new aws.dynamodb.Table(`hutch-articles`, {
			name: args.tableNames.articles,
			billingMode: "PAY_PER_REQUEST",
			deletionProtectionEnabled: args.deletionProtection,
			pointInTimeRecovery: { enabled: true },
			hashKey: "url",
			attributes: [
				{ name: "url", type: "S" },
				{ name: "routeId", type: "S" },
			],
			globalSecondaryIndexes: [
				{
					name: "routeId-index",
					hashKey: "routeId",
					projectionType: "ALL",
				},
			],
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.userArticlesTable = new aws.dynamodb.Table(`hutch-user-articles`, {
			name: args.tableNames.userArticles,
			billingMode: "PAY_PER_REQUEST",
			deletionProtectionEnabled: args.deletionProtection,
			pointInTimeRecovery: { enabled: true },
			hashKey: "userId",
			rangeKey: "url",
			attributes: [
				{ name: "userId", type: "S" },
				{ name: "url", type: "S" },
				{ name: "savedAt", type: "S" },
				{ name: "readAt", type: "S" },
			],
			globalSecondaryIndexes: [
				{
					name: "userId-savedAt-index",
					hashKey: "userId",
					rangeKey: "savedAt",
					projectionType: "ALL",
				},
				{
					name: "userId-readAt-index",
					hashKey: "userId",
					rangeKey: "readAt",
					projectionType: "ALL",
				},
				/* Reverse lookup for reader-ready fan-out: every saver of a URL.
				 * `url` is on every item already, so no backfill. */
				{
					name: "url-index",
					hashKey: "url",
					projectionType: "ALL",
				},
			],
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.usersTable = new aws.dynamodb.Table(`hutch-users`, {
			name: args.tableNames.users,
			billingMode: "PAY_PER_REQUEST",
			deletionProtectionEnabled: args.deletionProtection,
			pointInTimeRecovery: { enabled: true },
			hashKey: "email",
			attributes: [
				{ name: "email", type: "S" },
				{ name: "userId", type: "S" },
				{ name: "userIdPrefix", type: "S" },
			],
			globalSecondaryIndexes: [
				{
					name: "userId-index",
					hashKey: "userId",
					projectionType: "ALL",
				},
				{
					name: "userIdPrefix-index",
					hashKey: "userIdPrefix",
					projectionType: "KEYS_ONLY",
				},
			],
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.sessionsTable = new aws.dynamodb.Table(`hutch-sessions`, {
			name: args.tableNames.sessions,
			billingMode: "PAY_PER_REQUEST",
			hashKey: "sessionId",
			attributes: [{ name: "sessionId", type: "S" }],
			ttl: {
				attributeName: "expiresAt",
				enabled: true,
			},
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.oauthTable = new aws.dynamodb.Table(`hutch-oauth`, {
			name: args.tableNames.oauth,
			billingMode: "PAY_PER_REQUEST",
			hashKey: "pk",
			attributes: [
				{ name: "pk", type: "S" },
				{ name: "userId", type: "S" },
			],
			globalSecondaryIndexes: [
				{
					name: "userId-index",
					hashKey: "userId",
					projectionType: "ALL",
				},
			],
			ttl: {
				attributeName: "expiresAt",
				enabled: true,
			},
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.verificationTokensTable = new aws.dynamodb.Table(`hutch-verification-tokens`, {
			name: args.tableNames.verificationTokens,
			billingMode: "PAY_PER_REQUEST",
			hashKey: "token",
			attributes: [{ name: "token", type: "S" }],
			ttl: {
				attributeName: "expiresAt",
				enabled: true,
			},
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.passwordResetTokensTable = new aws.dynamodb.Table(`hutch-password-reset-tokens`, {
			name: args.tableNames.passwordResetTokens,
			billingMode: "PAY_PER_REQUEST",
			hashKey: "token",
			attributes: [{ name: "token", type: "S" }]
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.pendingSignupsTable = new aws.dynamodb.Table(`hutch-pending-signups`, {
			name: args.tableNames.pendingSignups,
			billingMode: "PAY_PER_REQUEST",
			hashKey: "checkoutSessionId",
			attributes: [{ name: "checkoutSessionId", type: "S" }]
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.importSessionsTable = new aws.dynamodb.Table(`hutch-import-sessions`, {
			name: args.tableNames.importSessions,
			billingMode: "PAY_PER_REQUEST",
			hashKey: "sessionId",
			attributes: [{ name: "sessionId", type: "S" }],
			ttl: {
				attributeName: "expiresAt",
				enabled: true,
			},
		}, { parent: this, aliases: [{ parent: pulumi.rootStackResource }] });

		this.subscriptionProvidersTable = new aws.dynamodb.Table(`hutch-subscription-providers`, {
			name: args.tableNames.subscriptionProviders,
			billingMode: "PAY_PER_REQUEST",
			deletionProtectionEnabled: args.deletionProtection,
			pointInTimeRecovery: { enabled: true },
			hashKey: "userId",
			attributes: [
				{ name: "userId", type: "S" },
				{ name: "subscriptionId", type: "S" },
			],
			globalSecondaryIndexes: [
				{
					name: "subscriptionId-index",
					hashKey: "subscriptionId",
					projectionType: "ALL",
				},
			],
		}, { parent: this });

		this.registerOutputs();
	}
}
