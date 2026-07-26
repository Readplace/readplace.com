import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export class HutchStorage extends pulumi.ComponentResource {
	public readonly articlesTable: aws.dynamodb.Table;
	public readonly userArticlesTable: aws.dynamodb.Table;
	public readonly usersTable: aws.dynamodb.Table;
	public readonly readerReadyNotificationsTable: aws.dynamodb.Table;
	public readonly sessionsTable: aws.dynamodb.Table;
	public readonly oauthTable: aws.dynamodb.Table;
	public readonly verificationTokensTable: aws.dynamodb.Table;
	public readonly passwordResetTokensTable: aws.dynamodb.Table;
	public readonly pendingSignupsTable: aws.dynamodb.Table;
	public readonly importSessionsTable: aws.dynamodb.Table;
	public readonly inboxAddressesTable: aws.dynamodb.Table;
	public readonly inboxEmailsTable: aws.dynamodb.Table;
	public readonly inboxEmailLinksTable: aws.dynamodb.Table;
	public readonly inboxSavedLinksTable: aws.dynamodb.Table;
	public readonly subscriptionProvidersTable: aws.dynamodb.Table;
	public readonly onboardingTable: aws.dynamodb.Table;
	public readonly rateLimitsTable: aws.dynamodb.Table;
	public readonly digestQueueTable: aws.dynamodb.Table;

	constructor(name: string, args: { deletionProtection: boolean; tableNames: {
		articles: string;
		userArticles: string;
		users: string;
		readerReadyNotifications: string;
		sessions: string;
		oauth: string;
		verificationTokens: string;
		passwordResetTokens: string;
		pendingSignups: string;
		importSessions: string;
		inboxAddresses: string;
		inboxEmails: string;
		inboxEmailLinks: string;
		inboxSavedLinks: string;
		subscriptionProviders: string;
		onboarding: string;
		rateLimits: string;
		digestQueue: string;
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

		/* Per-user reader-ready notification state (the 6h email cooldown),
		 * keyed by userId. Kept off the users row so notification bookkeeping
		 * doesn't couple to the auth aggregate; the claim is a direct PK
		 * conditional write. */
		this.readerReadyNotificationsTable = new aws.dynamodb.Table(`hutch-reader-ready-notifications`, {
			name: args.tableNames.readerReadyNotifications,
			billingMode: "PAY_PER_REQUEST",
			deletionProtectionEnabled: args.deletionProtection,
			pointInTimeRecovery: { enabled: true },
			hashKey: "userId",
			attributes: [{ name: "userId", type: "S" }],
		}, { parent: this });

		this.sessionsTable = new aws.dynamodb.Table(`hutch-sessions`, {
			name: args.tableNames.sessions,
			billingMode: "PAY_PER_REQUEST",
			hashKey: "sessionId",
			attributes: [
				{ name: "sessionId", type: "S" },
				{ name: "userId", type: "S" },
			],
			globalSecondaryIndexes: [
				{
					name: "userId-index",
					hashKey: "userId",
					projectionType: "KEYS_ONLY",
				},
			],
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
			attributes: [{ name: "token", type: "S" }],
			/* Expire reset tokens on the same `expiresAt` (epoch seconds) the row
			 * already carries, like every sibling token table. Beyond token hygiene
			 * this is the compliance backstop for account deletion: the delete-account
			 * scrub matches rows by the *normalized* email, so a token written before
			 * the write-path normalization (a raw `John@Example.com`) can't be matched
			 * and — without this TTL — would outlive the deleted account forever. TTL
			 * erases those pre-normalization stragglers within ~48h with no one-off
			 * backfill; the synchronous scrub still erases every new row immediately. */
			ttl: {
				attributeName: "expiresAt",
				enabled: true,
			},
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

		/* Per-user email forwarding addresses (in-<token>@<domain>). The address
		 * is the PK so the M2 receive path can resolve address → userId and so
		 * creation can guarantee global uniqueness with a conditional put; the
		 * userId GSI answers the inbox page's "list my addresses" query. Kept
		 * forever (no TTL) and disable-only — a freed hash could be re-minted for
		 * another user and leak their mail — so deletion protection + PITR are on. */
		this.inboxAddressesTable = new aws.dynamodb.Table(`hutch-inbox-addresses`, {
			name: args.tableNames.inboxAddresses,
			billingMode: "PAY_PER_REQUEST",
			deletionProtectionEnabled: args.deletionProtection,
			pointInTimeRecovery: { enabled: true },
			hashKey: "address",
			attributes: [
				{ name: "address", type: "S" },
				{ name: "userId", type: "S" },
			],
			globalSecondaryIndexes: [
				{
					name: "userId-index",
					hashKey: "userId",
					projectionType: "ALL",
				},
			],
		}, { parent: this });

		/* Received emails, one row per forwarded message. PK=userId + a
		 * `${receivedAt}#${messageId}` sort key answers both web reads — the
		 * newest-first list (descending query) and the single-email detail (get) —
		 * off the base table with no GSI. Emails are kept forever (no TTL); the body
		 * never lives here (always S3), so the 400 KB item limit is unreachable.
		 * Deletion protection + PITR guard the only durable copy of receipt metadata. */
		this.inboxEmailsTable = new aws.dynamodb.Table(`hutch-inbox-emails`, {
			name: args.tableNames.inboxEmails,
			billingMode: "PAY_PER_REQUEST",
			deletionProtectionEnabled: args.deletionProtection,
			pointInTimeRecovery: { enabled: true },
			hashKey: "userId",
			rangeKey: "receivedAtMessageId",
			attributes: [
				{ name: "userId", type: "S" },
				{ name: "receivedAtMessageId", type: "S" },
			],
		}, { parent: this });

		/* Crawled previews of the links found inside a received email, one row per
		 * link. PK=`${userId}#${receivedAtMessageId}` colocates every link of one
		 * email (and a reserved `meta` sort-key item holding the truncated flag) so
		 * the Articles tab reads them in a single Query — no GSI, no scan. Each link
		 * transitions (pending→crawled/failed) and is polled independently, so it
		 * needs its own row rather than inlining onto the email. Kept forever (no
		 * TTL); re-derivable from the raw .eml, so deletion protection + PITR guard
		 * the cache without making it the system of record. */
		this.inboxEmailLinksTable = new aws.dynamodb.Table(`hutch-inbox-email-links`, {
			name: args.tableNames.inboxEmailLinks,
			billingMode: "PAY_PER_REQUEST",
			deletionProtectionEnabled: args.deletionProtection,
			pointInTimeRecovery: { enabled: true },
			hashKey: "userLinkGroup",
			rangeKey: "ordinal",
			attributes: [
				{ name: "userLinkGroup", type: "S" },
				{ name: "ordinal", type: "S" },
			],
		}, { parent: this });

		/* Which links a reader has already had accepted into their queue, so the
		 * Articles tab can render its Saved button without the inbox ever reading
		 * the articles/user-articles tables. PK=userId, SK=the normalized URL, so a
		 * page of cards resolves in one BatchGetItem — no GSI, no scan. Written only
		 * by the record-link-queued subscriber, off the save-side facts. A moment-in-
		 * time record, not the queue's own state: removing an article publishes no
		 * fact, so a row here outlives the queue row it describes. */
		this.inboxSavedLinksTable = new aws.dynamodb.Table(`hutch-inbox-saved-links`, {
			name: args.tableNames.inboxSavedLinks,
			billingMode: "PAY_PER_REQUEST",
			deletionProtectionEnabled: args.deletionProtection,
			pointInTimeRecovery: { enabled: true },
			hashKey: "userId",
			rangeKey: "linkKey",
			attributes: [
				{ name: "userId", type: "S" },
				{ name: "linkKey", type: "S" },
			],
		}, { parent: this });

		/* Fixed-window throttle counters (per-IP buckets + the global paid-crawl
		 * budget), each row one window. Ephemeral by definition — no deletion
		 * protection or point-in-time recovery; TTL purges expired windows. */
		this.rateLimitsTable = new aws.dynamodb.Table(`hutch-rate-limits`, {
			name: args.tableNames.rateLimits,
			billingMode: "PAY_PER_REQUEST",
			hashKey: "pk",
			attributes: [{ name: "pk", type: "S" }],
			ttl: {
				attributeName: "expiresAt",
				enabled: true,
			},
		}, { parent: this });

		/* Per-(user, article) reader-ready digest queue. Rows are appended by the
		 * reader-ready fan-out and drained when the 6h digest sends. Ephemeral by
		 * definition — no deletion protection or point-in-time recovery; TTL on
		 * `expiresAt` purges any row a send never got to. */
		this.digestQueueTable = new aws.dynamodb.Table(`hutch-digest-queue`, {
			name: args.tableNames.digestQueue,
			billingMode: "PAY_PER_REQUEST",
			hashKey: "userId",
			rangeKey: "url",
			attributes: [
				{ name: "userId", type: "S" },
				{ name: "url", type: "S" },
			],
			ttl: {
				attributeName: "expiresAt",
				enabled: true,
			},
		}, { parent: this });

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

		/* Per-user onboarding state, keyed by userId. Holds the iOS app signals
		 * (activated/saved) the iPhone /queue render reads, kept off the users row
		 * so onboarding bookkeeping doesn't couple to the auth aggregate; future
		 * per-user onboarding state registers here too. */
		this.onboardingTable = new aws.dynamodb.Table(`hutch-onboarding`, {
			name: args.tableNames.onboarding,
			billingMode: "PAY_PER_REQUEST",
			deletionProtectionEnabled: args.deletionProtection,
			pointInTimeRecovery: { enabled: true },
			hashKey: "userId",
			attributes: [{ name: "userId", type: "S" }],
		}, { parent: this });

		this.registerOutputs();
	}
}
