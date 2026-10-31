import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import {
	ForwardableSenderSchema,
	GMAIL_MARK_BACKFILL_COUNT_FIELDS,
	GmailAccountEmailSchema,
	GmailMarkBackfillCancelReasonSchema,
	type GmailMarkBackfillCounts,
	GmailMarkBackfillCountsSchema,
	GmailMarkBackfillFailureReasonSchema,
	type GmailMarkBackfillJob,
	type GmailMarkBackfillRef,
	GmailMarkBackfillStateSchema,
	type GmailMarkBackfillStore,
	gmailAccountKey,
	planGmailMarkBackfillStart,
} from "@packages/domain/gmail";
import { type UserId, UserIdSchema } from "@packages/domain/user";

const RECORD_PREFIX = "MARK_BACKFILL#";
const PAGE_LEASE_MS = 60_000;

const BackfillRow = z.object({
	userId: UserIdSchema,
	recordKey: z.string().startsWith(RECORD_PREFIX),
	accountEmail: GmailAccountEmailSchema,
	senderEmail: ForwardableSenderSchema,
	optionEnabledAt: z.string(),
	generation: z.number().int().positive(),
	page: z.number().int().nonnegative(),
	cursor: dynamoField(z.string()),
	state: GmailMarkBackfillStateSchema,
	counts: GmailMarkBackfillCountsSchema,
	failureReason: dynamoField(GmailMarkBackfillFailureReasonSchema),
	cancelReason: dynamoField(GmailMarkBackfillCancelReasonSchema),
	startedAt: z.string(),
	updatedAt: z.string(),
	finishedAt: dynamoField(z.string()),
});

function backfillKey(ref: GmailMarkBackfillRef): { userId: UserId; recordKey: string } {
	return { userId: ref.userId, recordKey: `${RECORD_PREFIX}${gmailAccountKey(ref.accountEmail)}#${ref.senderEmail}` };
}

function toJob(row: z.infer<typeof BackfillRow>): GmailMarkBackfillJob {
	return {
		userId: row.userId,
		accountEmail: row.accountEmail,
		senderEmail: row.senderEmail,
		optionEnabledAt: row.optionEnabledAt,
		generation: row.generation,
		page: row.page,
		cursor: row.cursor,
		state: row.state,
		counts: row.counts,
		failureReason: row.failureReason,
		cancelReason: row.cancelReason,
		startedAt: row.startedAt,
		updatedAt: row.updatedAt,
		finishedAt: row.finishedAt,
	};
}

function definedOnly(item: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
}

function addedCounts(counts: GmailMarkBackfillCounts): {
	expression: string;
	names: Record<string, string>;
	values: Record<string, number>;
} {
	return {
		expression: GMAIL_MARK_BACKFILL_COUNT_FIELDS.map((field) => `#counts.#${field} = #counts.#${field} + :add_${field}`).join(", "),
		names: Object.fromEntries([["#counts", "counts"], ...GMAIL_MARK_BACKFILL_COUNT_FIELDS.map((field) => [`#${field}`, field])]),
		values: Object.fromEntries(GMAIL_MARK_BACKFILL_COUNT_FIELDS.map((field) => [`:add_${field}`, counts[field]])),
	};
}

async function conditionalWrite(write: () => Promise<unknown>): Promise<boolean> {
	try {
		await write();
		return true;
	} catch (error) {
		if (!(error instanceof ConditionalCheckFailedException)) throw error;
		return false;
	}
}

export function initDynamoDbGmailMarkBackfill(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): GmailMarkBackfillStore {
	const table = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: BackfillRow });

	const findBackfill: GmailMarkBackfillStore["findBackfill"] = async (ref) => {
		const row = await table.get(backfillKey(ref), { consistentRead: true });
		return row === undefined ? undefined : toJob(row);
	};

	const pageWrite = (input: GmailMarkBackfillRef & {
		generation: number;
		page: number;
		counts: GmailMarkBackfillCounts;
		set: string;
		names: Record<string, string>;
		values: Record<string, unknown>;
		now: Date;
	}) => {
		const added = addedCounts(input.counts);
		return conditionalWrite(() =>
			table.update({
				Key: backfillKey(input),
				UpdateExpression: `SET ${input.set}, ${added.expression}, updatedAt = :now REMOVE claimUntil`,
				ConditionExpression: "generation = :generation AND #page = :page AND #state = :running",
				ExpressionAttributeNames: { ...input.names, "#page": "page", "#state": "state", ...added.names },
				ExpressionAttributeValues: {
					...input.values,
					...added.values,
					":now": input.now.toISOString(),
					":generation": input.generation,
					":page": input.page,
					":running": "running",
				},
			}),
		);
	};

	return {
		startBackfill: async ({ userId, accountEmail, senderEmail, optionEnabledAt, now }) => {
			const ref = { userId, accountEmail, senderEmail };
			const existing = await findBackfill(ref);
			const job = planGmailMarkBackfillStart({ existing, ref, optionEnabledAt, now });
			if (job === undefined) return { started: false };
			const written = await conditionalWrite(() =>
				table.put({
					Item: definedOnly({ ...job, ...backfillKey(job) }),
					...(existing === undefined
						? { ConditionExpression: "attribute_not_exists(recordKey)" }
						: { ConditionExpression: "generation = :seen", ExpressionAttributeValues: { ":seen": existing.generation } }),
				}),
			);
			return written ? { started: true, job } : { started: false };
		},
		findBackfill,
		listBackfillsByUserId: async (userId) => {
			const found: GmailMarkBackfillJob[] = [];
			await forEachQueryPage(
				table,
				{
					KeyConditionExpression: "userId = :uid AND begins_with(recordKey, :prefix)",
					ExpressionAttributeValues: { ":uid": userId, ":prefix": RECORD_PREFIX },
					ConsistentRead: true,
				},
				async (rows) => {
					for (const row of rows) found.push(toJob(row));
				},
			);
			return found;
		},
		claimPage: async ({ generation, page, now, ...ref }) =>
			conditionalWrite(() =>
				table.update({
					Key: backfillKey(ref),
					UpdateExpression: "SET #state = :running, claimUntil = :until, updatedAt = :now",
					ConditionExpression:
						"generation = :generation AND #page = :page AND #state IN (:queued, :running) AND (attribute_not_exists(claimUntil) OR claimUntil <= :nowMs)",
					ExpressionAttributeNames: { "#state": "state", "#page": "page" },
					ExpressionAttributeValues: {
						":generation": generation,
						":page": page,
						":queued": "queued",
						":running": "running",
						":nowMs": now.getTime(),
						":until": now.getTime() + PAGE_LEASE_MS,
						":now": now.toISOString(),
					},
				}),
			),
		savePage: async ({ cursor, ...input }) =>
			pageWrite({ ...input, set: "#page = :next, #cursor = :cursor", names: { "#cursor": "cursor" }, values: { ":next": input.page + 1, ":cursor": cursor } }),
		complete: async (input) =>
			pageWrite({ ...input, set: "#state = :complete, finishedAt = :now", names: {}, values: { ":complete": "complete" } }),
		failBackfill: async ({ generation, reason, now, ...ref }) => {
			const written = await conditionalWrite(() =>
				table.update({
					Key: backfillKey(ref),
					UpdateExpression: "SET #state = :failed, failureReason = :reason, finishedAt = :now, updatedAt = :now REMOVE claimUntil",
					ConditionExpression:
						generation === undefined ? "#state IN (:queued, :running)" : "generation = :generation AND #state IN (:queued, :running)",
					ExpressionAttributeNames: { "#state": "state" },
					ExpressionAttributeValues: {
						":failed": "failed",
						":reason": reason,
						":now": now.toISOString(),
						":queued": "queued",
						":running": "running",
						...(generation === undefined ? {} : { ":generation": generation }),
					},
				}),
			);
			return written ? "failed" : "unchanged";
		},
		cancelBackfill: async ({ generation, reason, now, ...ref }) => {
			const written = await conditionalWrite(() =>
				table.update({
					Key: backfillKey(ref),
					UpdateExpression: "SET #state = :cancelled, cancelReason = :reason, finishedAt = :now, updatedAt = :now REMOVE claimUntil",
					ConditionExpression:
						generation === undefined ? "#state IN (:queued, :running)" : "generation = :generation AND #state IN (:queued, :running)",
					ExpressionAttributeNames: { "#state": "state" },
					ExpressionAttributeValues: {
						":cancelled": "cancelled",
						":reason": reason,
						":now": now.toISOString(),
						":queued": "queued",
						":running": "running",
						...(generation === undefined ? {} : { ":generation": generation }),
					},
				}),
			);
			return written ? "cancelled" : "unchanged";
		},
	};
}
