import assert from "node:assert/strict";
import { SavedLinksJobIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/storage-client";
import { initDynamoDbSavedLinksJob } from "./dynamodb-saved-links-job";

type Item = Record<string, unknown>;
type Sent = { name: string; input: Item };
type Reply = (input: Item) => unknown;

const TABLE = "user-articles";
const READER = UserIdSchema.parse("reader-1");
const JOB_KEY = { userId: READER, url: `readplace:saved-links-job/${READER}` };
const JOB = SavedLinksJobIdSchema.parse("2026-11-20T10:00:00.000Z-job");
const REQUESTED_AT = new Date("2026-11-20T10:00:00.000Z");

function createScriptedClient(script: Record<string, Reply[]>) {
	const sent: Sent[] = [];
	const send = async (command: { constructor: { name: string }; input: Item }) => {
		const name = command.constructor.name;
		sent.push({ name, input: command.input });
		const reply = script[name]?.shift();
		assert(reply, `no scripted reply left for ${name}`);
		return reply(command.input);
	};
	const jobs = initDynamoDbSavedLinksJob({ client: { send } as unknown as DynamoDBDocumentClient, userArticlesTableName: TABLE });
	return { jobs, sent };
}

const written: Reply = () => ({});
const refused: Reply = () => {
	throw new ConditionalCheckFailedException({ $metadata: {}, message: "condition failed" });
};
const found = (item: Item | undefined): Reply => () => ({ Item: item });

function jobRow(overrides: Item = {}): Item {
	return {
		...JOB_KEY,
		jobId: JOB,
		action: "remove",
		state: "running",
		requestedAt: REQUESTED_AT.toISOString(),
		counts: { held: 2 },
		...overrides,
	};
}

describe("requestSavedLinksJob", () => {
	it("claims the reader's job row when none is open", async () => {
		const { jobs, sent } = createScriptedClient({ PutCommand: [written] });

		assert.deepEqual(await jobs.requestSavedLinksJob({ userId: READER, jobId: JOB, action: "remove", requestedAt: REQUESTED_AT }), {
			outcome: "claimed",
		});
		assert.deepEqual(sent[0].input.Item, {
			...JOB_KEY,
			jobId: JOB,
			action: "remove",
			state: "requested",
			requestedAt: REQUESTED_AT.toISOString(),
			counts: {},
		});
		assert.equal(sent[0].input.ConditionExpression, "attribute_not_exists(#url) OR #state IN (:completed, :failed)");
	});

	it("is busy with the open job when one is requested or running", async () => {
		const { jobs } = createScriptedClient({ PutCommand: [refused], GetCommand: [found(jobRow())] });

		assert.deepEqual(await jobs.requestSavedLinksJob({ userId: READER, jobId: JOB, action: "restore", requestedAt: REQUESTED_AT }), {
			outcome: "busy",
			job: { jobId: JOB, action: "remove", state: "running", requestedAt: REQUESTED_AT, counts: { held: 2 } },
		});
	});

	it("tries again when the open job vanished between the refusal and the read", async () => {
		const { jobs } = createScriptedClient({ PutCommand: [refused, written], GetCommand: [found(undefined)] });

		assert.deepEqual(await jobs.requestSavedLinksJob({ userId: READER, jobId: JOB, action: "remove", requestedAt: REQUESTED_AT }), {
			outcome: "claimed",
		});
	});
});

describe("saved-links job progress", () => {
	it("records counts as running only for the job that holds the row and has not completed", async () => {
		const { jobs, sent } = createScriptedClient({ UpdateCommand: [written, refused] });

		assert.deepEqual(await jobs.recordSavedLinksJobProgress({ userId: READER, jobId: JOB, counts: { held: 3 } }), {
			outcome: "recorded",
		});
		assert.deepEqual(await jobs.recordSavedLinksJobProgress({ userId: READER, jobId: JOB, counts: { held: 4 } }), {
			outcome: "stale",
		});
		assert.deepEqual(sent[0].input.Key, JOB_KEY);
		assert.equal(sent[0].input.UpdateExpression, "SET #state = :running, counts = :counts REMOVE finishedAt");
		assert.equal(sent[0].input.ConditionExpression, "jobId = :jobId AND #state <> :completed");
		assert.equal(Object(sent[0].input.ExpressionAttributeValues)[":completed"], "completed");
		assert.deepEqual(Object(sent[0].input.ExpressionAttributeValues)[":counts"], { held: 3 });
	});

	it("finishes the job with its final state and counts, and never over a job that already completed", async () => {
		const finishedAt = new Date("2026-11-20T10:05:00.000Z");
		const { jobs, sent } = createScriptedClient({ UpdateCommand: [written, refused] });

		const finish = { userId: READER, jobId: JOB, state: "completed" as const, counts: { held: 5 }, finishedAt };
		assert.deepEqual(await jobs.finishSavedLinksJob(finish), { outcome: "recorded" });
		assert.deepEqual(await jobs.finishSavedLinksJob(finish), { outcome: "stale" });
		assert.equal(Object(sent[0].input.ExpressionAttributeValues)[":finishedAt"], finishedAt.toISOString());
		assert.equal(Object(sent[0].input.ExpressionAttributeValues)[":state"], "completed");
		assert.equal(sent[0].input.ConditionExpression, "jobId = :jobId AND #state <> :completed");
		assert.equal(Object(sent[0].input.ExpressionAttributeValues)[":completed"], "completed");
	});

	it("finds the reader's job, with its finish time once finished, and nothing when there is none", async () => {
		const { jobs, sent } = createScriptedClient({
			GetCommand: [found(jobRow({ state: "completed", finishedAt: "2026-11-20T10:05:00.000Z" })), found(undefined)],
		});

		assert.deepEqual(await jobs.findSavedLinksJob({ userId: READER }), {
			jobId: JOB,
			action: "remove",
			state: "completed",
			requestedAt: REQUESTED_AT,
			counts: { held: 2 },
			finishedAt: new Date("2026-11-20T10:05:00.000Z"),
		});
		assert.equal(await jobs.findSavedLinksJob({ userId: READER }), undefined);
		assert.equal(sent[0].input.ConsistentRead, true);
	});

	it("withdraws a job only while it is still requested", async () => {
		const { jobs, sent } = createScriptedClient({ DeleteCommand: [written, refused] });

		assert.deepEqual(await jobs.withdrawSavedLinksJob({ userId: READER, jobId: JOB }), { outcome: "withdrawn" });
		assert.deepEqual(await jobs.withdrawSavedLinksJob({ userId: READER, jobId: JOB }), { outcome: "stale" });
		assert.equal(sent[0].input.ConditionExpression, "jobId = :jobId AND #state = :requested");
	});
});
