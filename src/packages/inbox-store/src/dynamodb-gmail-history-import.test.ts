import {
	ConditionalCheckFailedException,
	TransactionCanceledException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailHistoryImportJob,
	GmailHistoryImportJobIdSchema,
	GmailMessageIdSchema,
} from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbGmailHistoryImport } from "./dynamodb-gmail-history-import";

type SendFn = DynamoDBDocumentClient["send"];

interface WriteItem {
	TableName?: string;
	Key?: Record<string, unknown>;
	Item?: Record<string, unknown>;
	UpdateExpression?: string;
	ConditionExpression?: string;
	ExpressionAttributeNames?: Record<string, string>;
	ExpressionAttributeValues?: Record<string, unknown>;
}

interface SentCommand {
	name: string;
	input: WriteItem & {
		ConsistentRead?: boolean;
		KeyConditionExpression?: string;
		ProjectionExpression?: string;
		ReturnValues?: string;
		ExclusiveStartKey?: Record<string, unknown>;
		TransactItems?: { Put?: WriteItem; Update?: WriteItem; ConditionCheck?: WriteItem }[];
	};
}

const TABLE = "test-gmail-history-imports";
const USER = UserIdSchema.parse("user-1");
const JOB_ID = GmailHistoryImportJobIdSchema.parse("0123456789abcdef0123456789abcdef");
const MESSAGE_ID = GmailMessageIdSchema.parse("18c2f0a1b2");
const NOW = new Date("2026-09-30T00:00:00.000Z");
const JOB_KEY = { userId: USER, recordKey: `JOB#${JOB_ID}` };
const MESSAGE_KEY = { userId: USER, recordKey: `MSG#${JOB_ID}#${MESSAGE_ID}` };
const ZERO_COUNTS = {
	listed: 0,
	imported: 0,
	alreadyImported: 0,
	skippedNoMessageId: 0,
	skippedSenderMismatch: 0,
	failed: 0,
	cancelled: 0,
};
const JOB: GmailHistoryImportJob = {
	userId: USER,
	jobId: JOB_ID,
	senderEmail: ForwardableSenderSchema.parse("news@example.com"),
	destinationAddress: InboxAddressSchema.parse("gmail-a7b2c9@read.place"),
	connection: {
		gatewayAddress: InboxAddressSchema.parse("gmail-f0rwrd@read.place"),
		accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
	},
	window: undefined,
	generation: "run-1",
	page: 0,
	pageToken: undefined,
	listingCompletedAt: undefined,
	state: "running",
	counts: ZERO_COUNTS,
	failureReason: undefined,
	cancelReason: undefined,
	createdAt: NOW.toISOString(),
	updatedAt: NOW.toISOString(),
	completedAt: undefined,
};

function jobRow(overrides: Partial<GmailHistoryImportJob> & { claimUntil?: number } = {}): Record<string, unknown> {
	const jobId = overrides.jobId ?? JOB_ID;
	return { ...JOB, userId: USER, recordKey: `JOB#${jobId}`, window: null, pageToken: null, listingCompletedAt: null, failureReason: null, cancelReason: null, completedAt: null, ...overrides };
}

function messageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		...MESSAGE_KEY,
		jobId: JOB_ID,
		gmailMessageId: MESSAGE_ID,
		generation: "run-1",
		rawS3Key: "gmail-import/user-1/job/18c2f0a1b2.eml",
		status: "fetched",
		recordedAt: NOW.toISOString(),
		...overrides,
	};
}

function conditionFailed(): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({ $metadata: {}, message: "The conditional request failed" });
}

function transactionConflict(): TransactionCanceledException {
	return new TransactionCanceledException({
		$metadata: {},
		message: "Transaction cancelled",
		CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
	});
}

function harness(reply: (command: SentCommand) => unknown = () => ({})) {
	const commands: SentCommand[] = [];
	const send = async (command: { constructor: { name: string }; input: SentCommand["input"] }) => {
		const sent = { name: command.constructor.name, input: command.input };
		commands.push(sent);
		return reply(sent);
	};
	const client: Partial<DynamoDBDocumentClient> = { send: send as unknown as SendFn };
	return { commands, store: initDynamoDbGmailHistoryImport({ client: client as DynamoDBDocumentClient, tableName: TABLE }) };
}

function isJobGet(command: SentCommand): boolean {
	return command.name === "GetCommand" && command.input.Key?.recordKey === JOB_KEY.recordKey;
}

describe("initDynamoDbGmailHistoryImport", () => {
	it("creates a job once, without writing its unset attributes", async () => {
		const { commands, store } = harness();

		await store.createJob(JOB);

		expect(commands[0].input).toEqual({
			TableName: TABLE,
			Item: {
				...JOB_KEY,
				jobId: JOB_ID,
				senderEmail: JOB.senderEmail,
				destinationAddress: JOB.destinationAddress,
				connection: JOB.connection,
				generation: "run-1",
				page: 0,
				state: "running",
				counts: ZERO_COUNTS,
				createdAt: NOW.toISOString(),
				updatedAt: NOW.toISOString(),
			},
			ConditionExpression: "attribute_not_exists(recordKey)",
		});
		const conflict = conditionFailed();
		await expect(harness(() => { throw conflict; }).store.createJob(JOB)).rejects.toBe(conflict);
	});

	it("finds a job with a consistent read, dropping the page lease", async () => {
		const window = { start: "2026-08-31T00:00:00.000Z", end: NOW.toISOString() };
		const { commands, store } = harness(() => ({ Item: jobRow({ window, claimUntil: 123 }) }));

		expect(await store.findJob({ userId: USER, jobId: JOB_ID })).toEqual({ ...JOB, window });
		expect(commands[0].input).toEqual(expect.objectContaining({ Key: JOB_KEY, ConsistentRead: true }));
		expect(await harness().store.findJob({ userId: USER, jobId: JOB_ID })).toBeUndefined();
	});

	it("lists the user's jobs across pages, never their message rows", async () => {
		const other = GmailHistoryImportJobIdSchema.parse("fedcba9876543210fedcba9876543210");
		const { commands, store } = harness((command) =>
			command.input.ExclusiveStartKey === undefined
				? { Items: [jobRow()], LastEvaluatedKey: JOB_KEY }
				: { Items: [jobRow({ jobId: other })] },
		);

		const listed = await store.listJobsByUserId(USER);

		expect(listed.map((job) => job.jobId)).toEqual([JOB_ID, other]);
		expect(commands[0].input).toEqual(
			expect.objectContaining({
				KeyConditionExpression: "userId = :uid AND begins_with(recordKey, :prefix)",
				ExpressionAttributeValues: { ":uid": USER, ":prefix": "JOB#" },
				ConsistentRead: true,
			}),
		);
	});

	describe("startJob", () => {
		it("queues a failed job in a new generation with the 30-day window, re-listing only unsettled messages", async () => {
			const failed = jobRow({
				state: "failed",
				failureReason: "gmail-rejected",
				pageToken: "p3",
				counts: { ...ZERO_COUNTS, listed: 10, imported: 5, alreadyImported: 1, skippedNoMessageId: 1, skippedSenderMismatch: 1, failed: 1, cancelled: 1 },
			});
			const { commands, store } = harness((command) =>
				command.name === "GetCommand" ? { Item: failed } : { Attributes: jobRow({ state: "queued", generation: "run-2" }) },
			);

			const started = await store.startJob({ userId: USER, jobId: JOB_ID, generation: "run-2", now: NOW });

			expect(started).toEqual({ ...JOB, state: "queued", generation: "run-2" });
			const update = commands[1].input;
			expect(update.ReturnValues).toBe("ALL_NEW");
			expect(update.UpdateExpression).toContain("#window = if_not_exists(#window, :window)");
			expect(update.UpdateExpression).toContain("REMOVE pageToken, listingCompletedAt, failureReason, completedAt, claimUntil");
			expect(update.ConditionExpression).toContain("generation = :previousGeneration AND #state = :previousState");
			expect(update.ConditionExpression).toContain("#counts.#imported = :seen_imported");
			expect(update.ExpressionAttributeValues).toEqual(
				expect.objectContaining({
					":generation": "run-2",
					":previousGeneration": "run-1",
					":previousState": "failed",
					":window": { start: "2026-08-31T00:00:00.000Z", end: NOW.toISOString() },
					":counts": { ...ZERO_COUNTS, listed: 8, imported: 5, alreadyImported: 1, skippedNoMessageId: 1, skippedSenderMismatch: 1 },
					":seen_failed": 1,
				}),
			);
		});

		it("refuses to restart a job that is not waiting, failed or partially failed", async () => {
			const { commands, store } = harness(() => ({ Item: jobRow({ state: "running" }) }));

			expect(await store.startJob({ userId: USER, jobId: JOB_ID, generation: "run-2", now: NOW })).toBeUndefined();
			expect(commands).toHaveLength(1);
			expect(await harness().store.startJob({ userId: USER, jobId: JOB_ID, generation: "run-2", now: NOW })).toBeUndefined();
		});

		it("re-reads and re-applies when an outcome lands between the read and the write", async () => {
			let reads = 0;
			const { commands, store } = harness((command) => {
				if (command.name === "GetCommand") {
					reads += 1;
					return { Item: jobRow({ state: "awaiting-permission", counts: { ...ZERO_COUNTS, imported: reads } }) };
				}
				if (reads === 1) throw conditionFailed();
				return { Attributes: jobRow({ state: "queued", generation: "run-2" }) };
			});

			expect((await store.startJob({ userId: USER, jobId: JOB_ID, generation: "run-2", now: NOW }))?.state).toBe("queued");
			expect(commands.map((c) => c.name)).toEqual(["GetCommand", "UpdateCommand", "GetCommand", "UpdateCommand"]);
			expect(commands[3].input.ExpressionAttributeValues?.[":seen_imported"]).toBe(2);
		});
	});

	it("claims a page with a lease only for the current generation and page", async () => {
		const { commands, store } = harness();

		expect(await store.claimPage({ userId: USER, jobId: JOB_ID, generation: "run-1", page: 2, now: NOW })).toBe(true);

		expect(commands[0].input.ConditionExpression).toContain("generation = :generation AND #page = :page AND #state IN (:queued, :running)");
		expect(commands[0].input.ConditionExpression).toContain("claimUntil <= :nowMs");
		expect(commands[0].input.ExpressionAttributeValues).toEqual(
			expect.objectContaining({ ":page": 2, ":nowMs": NOW.getTime(), ":until": NOW.getTime() + 60_000 }),
		);
		expect(await harness(() => { throw conditionFailed(); }).store.claimPage({ userId: USER, jobId: JOB_ID, generation: "run-1", page: 2, now: NOW })).toBe(false);
	});

	describe("recordFetched", () => {
		const fetched = { userId: USER, jobId: JOB_ID, generation: "run-1", gmailMessageId: MESSAGE_ID, rawS3Key: "gmail-import/user-1/job/18c2f0a1b2.eml", now: NOW };

		it("records a newly listed message and counts it in one transaction fenced on the running generation", async () => {
			const { commands, store } = harness((command) => (isJobGet(command) ? { Item: jobRow() } : {}));

			expect(await store.recordFetched(fetched)).toBe("recorded");

			expect(commands[1].input).toEqual(expect.objectContaining({ Key: MESSAGE_KEY, ConsistentRead: true }));
			const [put, count] = commands[2].input.TransactItems ?? [];
			expect(put.Put).toEqual(
				expect.objectContaining({ Item: messageRow(), ConditionExpression: "attribute_not_exists(recordKey)" }),
			);
			expect(count.Update?.UpdateExpression).toBe("SET #counts.#listed = #counts.#listed + :one");
			expect(count.Update?.ConditionExpression).toBe("generation = :generation AND #state = :running");
		});

		it("refreshes a message this generation already fetched without counting it again", async () => {
			const { commands, store } = harness((command) =>
				isJobGet(command) ? { Item: jobRow() } : command.name === "GetCommand" ? { Item: messageRow({ recordedAt: "earlier" }) } : {},
			);

			expect(await store.recordFetched(fetched)).toBe("recorded");

			const [put, check] = commands[2].input.TransactItems ?? [];
			expect(put.Put?.ConditionExpression).toBe("generation = :previousGeneration AND #status = :previousStatus");
			expect(put.Put?.ExpressionAttributeValues).toEqual({ ":previousGeneration": "run-1", ":previousStatus": "fetched" });
			expect(check.ConditionCheck?.ConditionExpression).toBe("generation = :generation AND #state = :running");
		});

		it("counts a message again when an earlier generation left it failed", async () => {
			const { commands, store } = harness((command) =>
				isJobGet(command) ? { Item: jobRow({ generation: "run-2" }) } : command.name === "GetCommand" ? { Item: messageRow({ status: "failed" }) } : {},
			);

			expect(await store.recordFetched({ ...fetched, generation: "run-2" })).toBe("recorded");

			expect(commands[2].input.TransactItems?.[1].Update?.ExpressionAttributeValues).toEqual({ ":generation": "run-2", ":running": "running", ":one": 1 });
		});

		it("leaves a settled message alone", async () => {
			const { commands, store } = harness((command) =>
				isJobGet(command) ? { Item: jobRow() } : { Item: messageRow({ status: "imported" }) },
			);

			expect(await store.recordFetched(fetched)).toBe("already-settled");
			expect(commands).toHaveLength(2);
		});

		it("is stale unless the job is running in the caller's generation", async () => {
			expect(await harness(() => ({ Item: jobRow({ state: "cancelled" }) })).store.recordFetched(fetched)).toBe("stale");
			expect(await harness(() => ({ Item: jobRow({ generation: "run-2" }) })).store.recordFetched(fetched)).toBe("stale");
			expect(await harness().store.recordFetched(fetched)).toBe("stale");
		});

		it("re-reads after losing the transaction to a concurrent change", async () => {
			let jobReads = 0;
			const { store } = harness((command) => {
				if (isJobGet(command)) {
					jobReads += 1;
					return { Item: jobRow({ state: jobReads === 1 ? "running" : "cancelled" }) };
				}
				if (command.name === "GetCommand") return {};
				throw transactionConflict();
			});

			expect(await store.recordFetched(fetched)).toBe("stale");
			expect(jobReads).toBe(2);
		});

		it("propagates a failed transaction that is not a condition failure", async () => {
			const throttled = new TransactionCanceledException({ $metadata: {}, message: "throttled", CancellationReasons: [{ Code: "ThrottlingError" }] });
			const { store } = harness((command) => {
				if (isJobGet(command)) return { Item: jobRow() };
				if (command.name === "GetCommand") return {};
				throw throttled;
			});

			await expect(store.recordFetched(fetched)).rejects.toBe(throttled);
		});
	});

	describe("savePage", () => {
		it("advances the page and keeps the next page token while more pages remain", async () => {
			const { commands, store } = harness();

			expect(await store.savePage({ previous: { ...JOB, page: 3 }, pageToken: "p4", now: NOW })).toBe(true);

			expect(commands[0].input.UpdateExpression).toBe("SET #page = :next, pageToken = :pageToken, updatedAt = :now REMOVE listingCompletedAt, claimUntil");
			expect(commands[0].input.ConditionExpression).toBe("generation = :generation AND #page = :page AND #state = :running");
			expect(commands[0].input.ExpressionAttributeValues).toEqual(expect.objectContaining({ ":next": 4, ":page": 3, ":pageToken": "p4" }));
		});

		it("marks the listing complete on the last page", async () => {
			const { commands, store } = harness();

			expect(await store.savePage({ previous: JOB, pageToken: undefined, now: NOW })).toBe(true);

			expect(commands[0].input.UpdateExpression).toBe("SET #page = :next, listingCompletedAt = :now, updatedAt = :now REMOVE pageToken, claimUntil");
			expect(commands[0].input.ExpressionAttributeValues).toEqual(expect.objectContaining({ ":next": 1, ":now": NOW.toISOString() }));
			expect(await harness(() => { throw conditionFailed(); }).store.savePage({ previous: JOB, pageToken: undefined, now: NOW })).toBe(false);
		});
	});

	describe("recordOutcome", () => {
		const outcome = { userId: USER, jobId: JOB_ID, generation: "run-1", gmailMessageId: MESSAGE_ID, outcome: "already-imported", now: NOW } as const;

		it("settles a fetched message and counts its outcome in one transaction fenced on both generations", async () => {
			const { commands, store } = harness();

			expect(await store.recordOutcome(outcome)).toBe("recorded");

			const [message, job] = commands[0].input.TransactItems ?? [];
			expect(message.Update).toEqual(
				expect.objectContaining({
					Key: MESSAGE_KEY,
					UpdateExpression: "SET #status = :outcome, recordedAt = :now",
					ConditionExpression: "generation = :generation AND #status = :fetched",
				}),
			);
			expect(job.Update).toEqual(
				expect.objectContaining({
					Key: JOB_KEY,
					UpdateExpression: "SET #counts.#outcome = #counts.#outcome + :one, updatedAt = :now",
					ConditionExpression: "generation = :generation",
					ExpressionAttributeNames: { "#counts": "counts", "#outcome": "alreadyImported" },
				}),
			);
		});

		it("reports a repeated outcome of the current generation as a duplicate", async () => {
			const { store } = harness((command) => {
				if (command.name === "TransactWriteCommand") throw transactionConflict();
				return { Item: isJobGet(command) ? jobRow() : messageRow({ status: "already-imported" }) };
			});

			expect(await store.recordOutcome(outcome)).toBe("duplicate");
		});

		it("reports an outcome from another generation as stale", async () => {
			const staleJob = harness((command) => {
				if (command.name === "TransactWriteCommand") throw transactionConflict();
				return { Item: isJobGet(command) ? jobRow({ generation: "run-2" }) : messageRow() };
			});
			expect(await staleJob.store.recordOutcome(outcome)).toBe("stale");

			const staleMessage = harness((command) => {
				if (command.name === "TransactWriteCommand") throw transactionConflict();
				return { Item: isJobGet(command) ? jobRow() : messageRow({ generation: "run-0" }) };
			});
			expect(await staleMessage.store.recordOutcome(outcome)).toBe("stale");
		});
	});

	describe("completeIfSettled", () => {
		const settled = { ...ZERO_COUNTS, listed: 3, imported: 1, failed: 1, cancelled: 1 };

		it("completes a running job whose listing is done and whose every listed message is settled", async () => {
			const { commands, store } = harness((command) =>
				command.name === "GetCommand"
					? { Item: jobRow({ listingCompletedAt: NOW.toISOString(), counts: settled }) }
					: { Attributes: jobRow({ state: "complete", completedAt: NOW.toISOString(), counts: settled }) },
			);

			const completed = await store.completeIfSettled({ userId: USER, jobId: JOB_ID, now: NOW });

			expect(completed?.state).toBe("complete");
			expect(commands[1].input.ConditionExpression).toContain("generation = :generation AND #state = :running AND attribute_exists(listingCompletedAt)");
			expect(commands[1].input.ConditionExpression).toContain("#counts.#listed = :seen_listed");
			expect(commands[1].input.ExpressionAttributeValues).toEqual(expect.objectContaining({ ":seen_listed": 3, ":seen_cancelled": 1 }));
		});

		it("leaves a job alone while it is not running, still listing, or has unsettled messages", async () => {
			for (const row of [
				jobRow({ state: "cancelled", listingCompletedAt: NOW.toISOString(), counts: settled }),
				jobRow({ counts: settled }),
				jobRow({ listingCompletedAt: NOW.toISOString(), counts: { ...settled, listed: 4 } }),
			]) {
				const { commands, store } = harness(() => ({ Item: row }));
				expect(await store.completeIfSettled({ userId: USER, jobId: JOB_ID, now: NOW })).toBeUndefined();
				expect(commands).toHaveLength(1);
			}
		});

		it("returns nothing when a concurrent writer completed the job first", async () => {
			const { store } = harness((command) => {
				if (command.name === "GetCommand") return { Item: jobRow({ listingCompletedAt: NOW.toISOString(), counts: settled }) };
				throw conditionFailed();
			});

			expect(await store.completeIfSettled({ userId: USER, jobId: JOB_ID, now: NOW })).toBeUndefined();
		});
	});

	describe("failJob", () => {
		it("fails a queued or running job of the given generation", async () => {
			const { commands, store } = harness(() => ({ Attributes: jobRow({ state: "failed", failureReason: "gmail-rejected" }) }));

			const failed = await store.failJob({ userId: USER, jobId: JOB_ID, generation: "run-1", reason: "gmail-rejected", now: NOW });

			expect(failed).toEqual({ ...JOB, state: "failed", failureReason: "gmail-rejected" });
			expect(commands[0].input.ConditionExpression).toBe("generation = :generation AND #state IN (:queued, :running)");
			expect(commands[0].input.ExpressionAttributeValues).toEqual(expect.objectContaining({ ":generation": "run-1", ":reason": "gmail-rejected" }));
		});

		it("leaves a job alone once its run has moved on or finished", async () => {
			const { store } = harness(() => { throw conditionFailed(); });

			expect(await store.failJob({ userId: USER, jobId: JOB_ID, generation: "run-0", reason: "dead-lettered", now: NOW })).toBeUndefined();
		});

		it("propagates a storage failure", async () => {
			const offline = new Error("offline");
			await expect(
				harness(() => { throw offline; }).store.failJob({ userId: USER, jobId: JOB_ID, generation: "run-1", reason: "gmail-rejected", now: NOW }),
			).rejects.toBe(offline);
		});
	});

	it("cancels the user's unfinished jobs for a sender, skipping finished jobs and ones that finished concurrently", async () => {
		const ids = ["a", "b", "c", "d"].map((letter) => GmailHistoryImportJobIdSchema.parse(letter.repeat(32)));
		const other = ForwardableSenderSchema.parse("other@example.com");
		const rows = [
			jobRow({ jobId: ids[0], state: "queued" }),
			jobRow({ jobId: ids[1], state: "complete" }),
			jobRow({ jobId: ids[2], state: "running", senderEmail: other }),
			jobRow({ jobId: ids[3], state: "awaiting-permission" }),
		];
		const { commands, store } = harness((command) => {
			if (command.name === "QueryCommand") return { Items: rows };
			if (command.input.Key?.recordKey === `JOB#${ids[3]}`) throw conditionFailed();
			return { Attributes: jobRow({ jobId: ids[0], state: "cancelled", cancelReason: "mapping-removed" }) };
		});

		const cancelled = await store.cancelJobs({ userId: USER, senderEmail: JOB.senderEmail, reason: "mapping-removed", now: NOW });

		expect(cancelled.map((job) => [job.jobId, job.state, job.cancelReason])).toEqual([[ids[0], "cancelled", "mapping-removed"]]);
		const updates = commands.filter((c) => c.name === "UpdateCommand");
		expect(updates.map((c) => c.input.Key?.recordKey)).toEqual([`JOB#${ids[0]}`, `JOB#${ids[3]}`]);
		expect(updates[0].input.ConditionExpression).toBe("#state IN (:awaiting, :queued, :running)");

		const everySender = harness((command) => (command.name === "QueryCommand" ? { Items: rows } : { Attributes: rows[2] }));
		await everySender.store.cancelJobs({ userId: USER, senderEmail: undefined, reason: "disconnected", now: NOW });
		expect(everySender.commands.filter((c) => c.name === "UpdateCommand")).toHaveLength(3);
	});

	it("deletes every job and message row the user owns, page by page", async () => {
		const { commands, store } = harness((command) => {
			if (command.name !== "QueryCommand") return {};
			return command.input.ExclusiveStartKey === undefined
				? { Items: [JOB_KEY], LastEvaluatedKey: JOB_KEY }
				: { Items: [MESSAGE_KEY] };
		});

		await store.deleteAllByUserId(USER);

		const query = commands[0].input;
		expect(query.KeyConditionExpression).toBe("userId = :uid");
		expect(query.ProjectionExpression).toBe("userId, recordKey");
		expect(commands.filter((c) => c.name === "DeleteCommand").map((c) => c.input.Key)).toEqual([JOB_KEY, MESSAGE_KEY]);
	});
});
