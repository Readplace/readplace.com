import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

/**
 * Every table the inbox owns. Lives in this stack rather than hutch's because
 * the inbox deployable is what reads and writes them; hutch keeps only the
 * grants its account-deletion worker and its forwarding-address page still need,
 * derived from config rather than from a cross-stack read.
 *
 * All four are keyed for a single Query or point read per access pattern — no
 * GSI, no scan.
 */
export class InboxStorage extends pulumi.ComponentResource {
	public readonly addressesTable: aws.dynamodb.Table;
	public readonly emailsTable: aws.dynamodb.Table;
	public readonly emailLinksTable: aws.dynamodb.Table;
	public readonly savedLinksTable: aws.dynamodb.Table;

	constructor(
		name: string,
		args: {
			deletionProtection: boolean;
			tableNames: {
				addresses: string;
				emails: string;
				emailLinks: string;
				savedLinks: string;
			};
		},
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("inbox:infra:InboxStorage", name, {}, opts);

		/* One row per minted forwarding address, keyed by the address itself so an
		 * inbound email resolves its owner in a single point read. The userId-index
		 * backs the reverse lookup (every address a user owns) that the addresses
		 * page and the account-deletion tombstone both walk. */
		this.addressesTable = new aws.dynamodb.Table(`hutch-inbox-addresses`, {
			name: args.tableNames.addresses,
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

		/* One row per received email, PK=userId so a reader's mail list is a single
		 * Query, SK=`${receivedAt}#${messageId}` so it returns newest-first without
		 * a sort in the app. */
		this.emailsTable = new aws.dynamodb.Table(`hutch-inbox-emails`, {
			name: args.tableNames.emails,
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
		this.emailLinksTable = new aws.dynamodb.Table(`hutch-inbox-email-links`, {
			name: args.tableNames.emailLinks,
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
		 * the articles/user-articles tables. PK=userId, SK=the hashed normalized URL
		 * (a sort key caps at 1024 bytes and ESP wrappers exceed it), so a page of
		 * cards resolves in one BatchGetItem — no GSI, no scan. Written only by the
		 * record-link-queued subscriber, off the save-side facts. A moment-in-time
		 * record, not the queue's own state: removing an article publishes no fact,
		 * so a row here outlives the queue row it describes. */
		this.savedLinksTable = new aws.dynamodb.Table(`hutch-inbox-saved-links`, {
			name: args.tableNames.savedLinks,
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

		this.registerOutputs();
	}
}
