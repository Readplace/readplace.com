import assert from "node:assert";
import {
	ConditionalCheckFailedException,
	TransactionCanceledException,
	TransactWriteCommand,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import {
	canRestartGmailHistoryImport,
	ForwardableSenderSchema,
	GMAIL_HISTORY_IMPORT_OUTCOME_COUNT,
	GMAIL_HISTORY_IMPORT_WINDOW_DAYS,
	GmailAccountEmailSchema,
	GmailHistoryImportCancelReasonSchema,
	type GmailHistoryImportCounts,
	GmailHistoryImportCountsSchema,
	GmailHistoryImportFailureReasonSchema,
	type GmailHistoryImportJob,
	type GmailHistoryImportJobId,
	GmailHistoryImportJobIdSchema,
	type GmailHistoryImportMessage,
	GmailHistoryImportMessageOutcomeSchema,
	type GmailHistoryImportState,
	GmailHistoryImportStateSchema,
	type GmailHistoryImportStore,
	type GmailMessageId,
	GmailMessageIdSchema,
	planFetchedRecording,
	restartedCounts,
	settledCount,
} from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { type UserId, UserIdSchema } from "@packages/domain/user";

const DAY_MS = 86_400_000;
const PAGE_LEASE_MS = 60_000;
const NON_TERMINAL: ReadonlySet<GmailHistoryImportState> = new Set(["awaiting-permission", "queued", "running"]);
const COUNT_FIELDS = [
	"listed",
	"imported",
	"alreadyImported",
	"skippedNoMessageId",
	"skippedSenderMismatch",
	"failed",
	"cancelled",
] as const satisfies readonly (keyof GmailHistoryImportCounts)[];

const JobRow = z.object({
	userId: UserIdSchema,
	recordKey: z.string().startsWith("JOB#"),
	jobId: GmailHistoryImportJobIdSchema,
	senderEmail: ForwardableSenderSchema,
	destinationAddress: InboxAddressSchema,
	additionalDestinationAddresses: dynamoField(z.array(InboxAddressSchema)),
	connection: z.object({ gatewayAddress: InboxAddressSchema, accountEmail: GmailAccountEmailSchema }),
	window: dynamoField(z.object({ start: z.string(), end: z.string() })),
	generation: z.string(),
	page: z.number().int().nonnegative(),
	pageToken: dynamoField(z.string()),
	listingCompletedAt: dynamoField(z.string()),
	state: GmailHistoryImportStateSchema,
	counts: GmailHistoryImportCountsSchema,
	failureReason: dynamoField(GmailHistoryImportFailureReasonSchema),
	cancelReason: dynamoField(GmailHistoryImportCancelReasonSchema),
	createdAt: z.string(),
	updatedAt: z.string(),
	completedAt: dynamoField(z.string()),
});

const MessageRow = z.object({
	userId: UserIdSchema,
	recordKey: z.string().startsWith("MSG#"),
	jobId: GmailHistoryImportJobIdSchema,
	gmailMessageId: GmailMessageIdSchema,
	generation: z.string(),
	rawS3Key: z.string(),
	status: z.enum(["fetched", ...GmailHistoryImportMessageOutcomeSchema.options]),
	recordedAt: z.string(),
});

const RecordKeyRow = z.object({
	userId: UserIdSchema,
	recordKey: z.string(),
});

type JobRef = { userId: UserId; jobId: GmailHistoryImportJobId };

function jobKey(input: JobRef): { userId: UserId; recordKey: string } {
	return { userId: input.userId, recordKey: `JOB#${input.jobId}` };
}

function messageKey(input: JobRef & { gmailMessageId: GmailMessageId }): { userId: UserId; recordKey: string } {
	return { userId: input.userId, recordKey: `MSG#${input.jobId}#${input.gmailMessageId}` };
}

function toJob(row: z.infer<typeof JobRow>): GmailHistoryImportJob {
	return {
		userId: row.userId,
		jobId: row.jobId,
		senderEmail: row.senderEmail,
		destinationAddresses: [row.destinationAddress, ...(row.additionalDestinationAddresses ?? [])],
		connection: row.connection,
		window: row.window,
		generation: row.generation,
		page: row.page,
		pageToken: row.pageToken,
		listingCompletedAt: row.listingCompletedAt,
		state: row.state,
		counts: row.counts,
		failureReason: row.failureReason,
		cancelReason: row.cancelReason,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		completedAt: row.completedAt,
	};
}

function toMessage(row: z.infer<typeof MessageRow>): GmailHistoryImportMessage {
	return {
		userId: row.userId,
		jobId: row.jobId,
		gmailMessageId: row.gmailMessageId,
		generation: row.generation,
		rawS3Key: row.rawS3Key,
		status: row.status,
		recordedAt: row.recordedAt,
	};
}

function definedOnly(item: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
}

function countsUnchanged(counts: GmailHistoryImportCounts): {
	expression: string;
	names: Record<string, string>;
	values: Record<string, number>;
} {
	return {
		expression: COUNT_FIELDS.map((field) => `#counts.#${field} = :seen_${field}`).join(" AND "),
		names: Object.fromEntries([["#counts", "counts"], ...COUNT_FIELDS.map((field) => [`#${field}`, field])]),
		values: Object.fromEntries(COUNT_FIELDS.map((field) => [`:seen_${field}`, counts[field]])),
	};
}

function messageUnchanged(existing: GmailHistoryImportMessage | undefined): {
	ConditionExpression: string;
	ExpressionAttributeNames?: Record<string, string>;
	ExpressionAttributeValues?: Record<string, string>;
} {
	if (existing === undefined) return { ConditionExpression: "attribute_not_exists(recordKey)" };
	return {
		ConditionExpression: "generation = :previousGeneration AND #status = :previousStatus",
		ExpressionAttributeNames: { "#status": "status" },
		ExpressionAttributeValues: { ":previousGeneration": existing.generation, ":previousStatus": existing.status },
	};
}

async function conditionalWrite(write: () => Promise<unknown>): Promise<boolean> {
	try {
		await write();
		return true;
	} catch (error) {
		if (error instanceof ConditionalCheckFailedException) return false;
		if (
			error instanceof TransactionCanceledException &&
			error.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed")
		) {
			return false;
		}
		throw error;
	}
}

export function initDynamoDbGmailHistoryImport(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): GmailHistoryImportStore {
	const jobs = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: JobRow });
	const messages = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: MessageRow });
	const records = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: RecordKeyRow });
	const transact = (TransactItems: NonNullable<TransactWriteCommand["input"]["TransactItems"]>) =>
		deps.client.send(new TransactWriteCommand({ TransactItems }));

	const findJob: GmailHistoryImportStore["findJob"] = async (input) => {
		const row = await jobs.get(jobKey(input), { consistentRead: true });
		return row === undefined ? undefined : toJob(row);
	};

	const findMessage = async (
		input: JobRef & { gmailMessageId: GmailMessageId },
	): Promise<GmailHistoryImportMessage | undefined> => {
		const row = await messages.get(messageKey(input), { consistentRead: true });
		return row === undefined ? undefined : toMessage(row);
	};

	const updateJob = async (
		input: Omit<Parameters<typeof jobs.update>[0], "ReturnValues">,
	): Promise<GmailHistoryImportJob | undefined> => {
		let updated: GmailHistoryImportJob | undefined;
		const written = await conditionalWrite(async () => {
			const { Attributes } = await jobs.update({ ...input, ReturnValues: "ALL_NEW" });
			assert(Attributes, "an ALL_NEW job update must return the job");
			updated = toJob(Attributes);
		});
		return written ? updated : undefined;
	};

	const listJobsByUserId: GmailHistoryImportStore["listJobsByUserId"] = async (userId) => {
		const found: GmailHistoryImportJob[] = [];
		await forEachQueryPage(
			jobs,
			{
				KeyConditionExpression: "userId = :uid AND begins_with(recordKey, :prefix)",
				ExpressionAttributeValues: { ":uid": userId, ":prefix": "JOB#" },
				ConsistentRead: true,
			},
			async (rows) => {
				for (const row of rows) found.push(toJob(row));
			},
		);
		return found;
	};

	return {
		createJob: async (job) => {
			const { destinationAddresses: [destinationAddress, ...additionalDestinationAddresses], ...attributes } = job;
			await jobs.put({
				Item: definedOnly({
					...attributes,
					...jobKey(job),
					destinationAddress,
					...(additionalDestinationAddresses.length === 0 ? {} : { additionalDestinationAddresses }),
				}),
				ConditionExpression: "attribute_not_exists(recordKey)",
			});
		},
		findJob,
		listJobsByUserId,
		startJob: async ({ userId, jobId, generation, now }) => {
			for (;;) {
				const job = await findJob({ userId, jobId });
				if (job === undefined || !canRestartGmailHistoryImport(job)) return undefined;
				const seen = countsUnchanged(job.counts);
				const started = await updateJob({
					Key: jobKey(job),
					UpdateExpression:
						"SET #state = :queued, generation = :generation, #window = if_not_exists(#window, :window), #page = :zero, #counts = :counts, updatedAt = :now REMOVE pageToken, listingCompletedAt, failureReason, completedAt, claimUntil",
					ConditionExpression: `generation = :previousGeneration AND #state = :previousState AND ${seen.expression}`,
					ExpressionAttributeNames: { "#state": "state", "#window": "window", "#page": "page", ...seen.names },
					ExpressionAttributeValues: {
						":queued": "queued",
						":generation": generation,
						":window": {
							start: new Date(now.getTime() - GMAIL_HISTORY_IMPORT_WINDOW_DAYS * DAY_MS).toISOString(),
							end: now.toISOString(),
						},
						":zero": 0,
						":counts": restartedCounts(job.counts),
						":now": now.toISOString(),
						":previousGeneration": job.generation,
						":previousState": job.state,
						...seen.values,
					},
				});
				if (started !== undefined) return started;
			}
		},
		claimPage: async ({ userId, jobId, generation, page, now }) =>
			conditionalWrite(() =>
				jobs.update({
					Key: jobKey({ userId, jobId }),
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
		recordFetched: async ({ userId, jobId, generation, gmailMessageId, rawS3Key, now }) => {
			for (;;) {
				const job = await findJob({ userId, jobId });
				if (job?.generation !== generation || job.state !== "running") return "stale";
				const existing = await findMessage({ userId, jobId, gmailMessageId });
				const recording = planFetchedRecording({ existing, generation });
				if (recording === "already-settled") return recording;
				const stillRunning = {
					TableName: deps.tableName,
					Key: jobKey(job),
					ConditionExpression: "generation = :generation AND #state = :running",
				};
				const recorded = await conditionalWrite(() =>
					transact([
						{
							Put: {
								TableName: deps.tableName,
								Item: {
									...messageKey({ userId, jobId, gmailMessageId }),
									jobId,
									gmailMessageId,
									generation,
									rawS3Key,
									status: "fetched",
									recordedAt: now.toISOString(),
								},
								...messageUnchanged(existing),
							},
						},
						recording === "count-new"
							? {
									Update: {
										...stillRunning,
										UpdateExpression: "SET #counts.#listed = #counts.#listed + :one",
										ExpressionAttributeNames: { "#state": "state", "#counts": "counts", "#listed": "listed" },
										ExpressionAttributeValues: { ":generation": generation, ":running": "running", ":one": 1 },
									},
								}
							: {
									ConditionCheck: {
										...stillRunning,
										ExpressionAttributeNames: { "#state": "state" },
										ExpressionAttributeValues: { ":generation": generation, ":running": "running" },
									},
								},
					]),
				);
				if (recorded) return "recorded";
			}
		},
		savePage: async ({ previous, pageToken, now }) =>
			conditionalWrite(() =>
				jobs.update({
					Key: jobKey(previous),
					...(pageToken === undefined
						? {
								UpdateExpression:
									"SET #page = :next, listingCompletedAt = :now, updatedAt = :now REMOVE pageToken, claimUntil",
								ExpressionAttributeValues: {
									":next": previous.page + 1,
									":now": now.toISOString(),
									":generation": previous.generation,
									":page": previous.page,
									":running": "running",
								},
							}
						: {
								UpdateExpression:
									"SET #page = :next, pageToken = :pageToken, updatedAt = :now REMOVE listingCompletedAt, claimUntil",
								ExpressionAttributeValues: {
									":next": previous.page + 1,
									":pageToken": pageToken,
									":now": now.toISOString(),
									":generation": previous.generation,
									":page": previous.page,
									":running": "running",
								},
							}),
					ConditionExpression: "generation = :generation AND #page = :page AND #state = :running",
					ExpressionAttributeNames: { "#page": "page", "#state": "state" },
				}),
			),
		recordOutcome: async ({ userId, jobId, generation, gmailMessageId, outcome, now }) => {
			const recorded = await conditionalWrite(() =>
				transact([
					{
						Update: {
							TableName: deps.tableName,
							Key: messageKey({ userId, jobId, gmailMessageId }),
							UpdateExpression: "SET #status = :outcome, recordedAt = :now",
							ConditionExpression: "generation = :generation AND #status = :fetched",
							ExpressionAttributeNames: { "#status": "status" },
							ExpressionAttributeValues: {
								":outcome": outcome,
								":now": now.toISOString(),
								":generation": generation,
								":fetched": "fetched",
							},
						},
					},
					{
						Update: {
							TableName: deps.tableName,
							Key: jobKey({ userId, jobId }),
							UpdateExpression: "SET #counts.#outcome = #counts.#outcome + :one, updatedAt = :now",
							ConditionExpression: "generation = :generation",
							ExpressionAttributeNames: {
								"#counts": "counts",
								"#outcome": GMAIL_HISTORY_IMPORT_OUTCOME_COUNT[outcome],
							},
							ExpressionAttributeValues: { ":one": 1, ":now": now.toISOString(), ":generation": generation },
						},
					},
				]),
			);
			if (recorded) return "recorded";
			const [message, job] = await Promise.all([
				findMessage({ userId, jobId, gmailMessageId }),
				findJob({ userId, jobId }),
			]);
			return message?.generation === generation && job?.generation === generation ? "duplicate" : "stale";
		},
		completeIfSettled: async ({ userId, jobId, now }) => {
			const job = await findJob({ userId, jobId });
			if (job?.state !== "running" || job.listingCompletedAt === undefined) return undefined;
			if (settledCount(job.counts) !== job.counts.listed) return undefined;
			const seen = countsUnchanged(job.counts);
			return updateJob({
				Key: jobKey(job),
				UpdateExpression: "SET #state = :complete, completedAt = :now, updatedAt = :now REMOVE claimUntil",
				ConditionExpression: `generation = :generation AND #state = :running AND attribute_exists(listingCompletedAt) AND ${seen.expression}`,
				ExpressionAttributeNames: { "#state": "state", ...seen.names },
				ExpressionAttributeValues: {
					":complete": "complete",
					":now": now.toISOString(),
					":generation": job.generation,
					":running": "running",
					...seen.values,
				},
			});
		},
		failJob: async ({ userId, jobId, generation, reason, now }) =>
			updateJob({
				Key: jobKey({ userId, jobId }),
				UpdateExpression: "SET #state = :failed, failureReason = :reason, updatedAt = :now REMOVE claimUntil",
				ConditionExpression: "generation = :generation AND #state IN (:queued, :running)",
				ExpressionAttributeNames: { "#state": "state" },
				ExpressionAttributeValues: {
					":failed": "failed",
					":reason": reason,
					":now": now.toISOString(),
					":queued": "queued",
					":running": "running",
					":generation": generation,
				},
			}),
		cancelJobs: async ({ userId, senderEmail, reason, now }) => {
			const unfinished = (await listJobsByUserId(userId)).filter(
				(job) => NON_TERMINAL.has(job.state) && (senderEmail === undefined || job.senderEmail === senderEmail),
			);
			const cancelled = await Promise.all(
				unfinished.map((job) =>
					updateJob({
						Key: jobKey(job),
						UpdateExpression: "SET #state = :cancelled, cancelReason = :reason, updatedAt = :now REMOVE claimUntil",
						ConditionExpression: "#state IN (:awaiting, :queued, :running)",
						ExpressionAttributeNames: { "#state": "state" },
						ExpressionAttributeValues: {
							":cancelled": "cancelled",
							":reason": reason,
							":now": now.toISOString(),
							":awaiting": "awaiting-permission",
							":queued": "queued",
							":running": "running",
						},
					}),
				),
			);
			return cancelled.filter((job): job is GmailHistoryImportJob => job !== undefined);
		},
		deleteAllByUserId: async (userId) => {
			await forEachQueryPage(
				records,
				{
					KeyConditionExpression: "userId = :uid",
					ProjectionExpression: "userId, recordKey",
					ExpressionAttributeValues: { ":uid": userId },
					ConsistentRead: true,
				},
				async (rows) => {
					await Promise.all(rows.map((row) => records.delete({ Key: { userId, recordKey: row.recordKey } })));
				},
			);
		},
	};
}
