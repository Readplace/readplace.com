import assert from "node:assert/strict";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbGmailMarkBackfill } from "./dynamodb-gmail-mark-backfill";

type SendFn = DynamoDBDocumentClient["send"];
interface Sent {
	name: string;
	input: Record<string, unknown> & {
		Key?: Record<string, unknown>;
		Item?: Record<string, unknown>;
		ExpressionAttributeValues?: Record<string, unknown>;
		ExpressionAttributeNames?: Record<string, string>;
		ExclusiveStartKey?: Record<string, unknown>;
	};
}

const USER = UserIdSchema.parse("user-1");
const REF = {
	userId: USER,
	accountEmail: GmailAccountEmailSchema.parse("Reader@Gmail.com"),
	senderEmail: ForwardableSenderSchema.parse("dan@tldr.tech"),
};
const KEY = { userId: USER, recordKey: "MARK_BACKFILL#reader@gmail.com#dan@tldr.tech" };
const ENABLED_AT = "2026-10-30T00:00:00.000Z";
const NOW = new Date("2026-10-31T00:00:00.000Z");
const COUNTS = { marked: 3, alreadyMarked: 1, notFound: 0, unlocatable: 2, notSaved: 1, failed: 0 };
const ROW = {
	...KEY,
	accountEmail: REF.accountEmail,
	senderEmail: REF.senderEmail,
	optionEnabledAt: ENABLED_AT,
	generation: 2,
	page: 3,
	cursor: "2026-10-01T00:00:00.000Z#<a@tldr.tech>",
	state: "failed",
	counts: COUNTS,
	failureReason: "gmail-rejected",
	startedAt: "2026-10-30T01:00:00.000Z",
	updatedAt: "2026-10-30T02:00:00.000Z",
	finishedAt: "2026-10-30T02:00:00.000Z",
};

function conditionFailed(): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({ message: "condition", $metadata: {} });
}

function store(respond: (command: Sent) => unknown = () => ({})) {
	const sent: Sent[] = [];
	const send = (async (command: { constructor: { name: string }; input: Sent["input"] }) => {
		const recorded = { name: command.constructor.name, input: command.input };
		sent.push(recorded);
		return respond(recorded);
	}) as SendFn;
	const client = { send } as unknown as DynamoDBDocumentClient;
	return { backfills: initDynamoDbGmailMarkBackfill({ client, tableName: "imports" }), sent };
}

describe("initDynamoDbGmailMarkBackfill", () => {
	it("creates the first job for a mapping only if no row exists yet", async () => {
		const { backfills, sent } = store();
		const result = await backfills.startBackfill({ ...REF, optionEnabledAt: ENABLED_AT, now: NOW });
		assert.equal(result.started, true);
		assert.equal(sent[0].name, "GetCommand");
		assert.equal(sent[0].input.ConsistentRead, true);
		assert.deepEqual(sent[1].input.Item, {
			...KEY,
			accountEmail: REF.accountEmail,
			senderEmail: REF.senderEmail,
			optionEnabledAt: ENABLED_AT,
			generation: 1,
			page: 0,
			state: "queued",
			counts: { marked: 0, alreadyMarked: 0, notFound: 0, unlocatable: 0, notSaved: 0, failed: 0 },
			startedAt: NOW.toISOString(),
			updatedAt: NOW.toISOString(),
		});
		assert.equal(sent[1].input.ConditionExpression, "attribute_not_exists(recordKey)");
	});

	it("restarts a failed job of the same on-period only while its generation is still the one read", async () => {
		const { backfills, sent } = store((command) => (command.name === "GetCommand" ? { Item: ROW } : {}));
		const result = await backfills.startBackfill({ ...REF, optionEnabledAt: ENABLED_AT, now: NOW });
		assert.deepEqual(result.started && { generation: result.job.generation, page: result.job.page, counts: result.job.counts }, {
			generation: 3,
			page: 3,
			counts: COUNTS,
		});
		assert.equal(sent[1].input.ConditionExpression, "generation = :seen");
		assert.equal(sent[1].input.ExpressionAttributeValues?.[":seen"], 2);
		assert.equal(sent[1].input.Item?.failureReason, undefined);
		assert.equal(sent[1].input.Item?.state, "queued");
	});

	it("reports a lost race as not started", async () => {
		const { backfills } = store((command) => {
			if (command.name === "PutCommand") throw conditionFailed();
			return { Item: ROW };
		});
		assert.deepEqual(await backfills.startBackfill({ ...REF, optionEnabledAt: ENABLED_AT, now: NOW }), { started: false });
	});

	it("does not start a job that is already running for the same on-period", async () => {
		const { backfills, sent } = store(() => ({ Item: { ...ROW, state: "running", failureReason: undefined } }));
		assert.deepEqual(await backfills.startBackfill({ ...REF, optionEnabledAt: ENABLED_AT, now: NOW }), { started: false });
		assert.equal(sent.length, 1);
	});

	it("rethrows a write failure that is not a lost condition", async () => {
		const { backfills } = store((command) => {
			if (command.name === "PutCommand") throw new Error("throttled");
			return {};
		});
		await assert.rejects(backfills.startBackfill({ ...REF, optionEnabledAt: ENABLED_AT, now: NOW }), /throttled/);
	});

	it("reads a job by its mapping", async () => {
		const { backfills, sent } = store(() => ({ Item: ROW }));
		assert.deepEqual(await backfills.findBackfill(REF), {
			userId: USER,
			accountEmail: REF.accountEmail,
			senderEmail: REF.senderEmail,
			optionEnabledAt: ENABLED_AT,
			generation: 2,
			page: 3,
			cursor: ROW.cursor,
			state: "failed",
			counts: COUNTS,
			failureReason: "gmail-rejected",
			cancelReason: undefined,
			startedAt: ROW.startedAt,
			updatedAt: ROW.updatedAt,
			finishedAt: ROW.finishedAt,
		});
		assert.deepEqual(sent[0].input.Key, KEY);
	});

	it("reads a missing job as undefined", async () => {
		const { backfills } = store(() => ({}));
		assert.equal(await backfills.findBackfill(REF), undefined);
	});

	it("lists the user's backfill rows page by page", async () => {
		const { backfills, sent } = store((command) =>
			command.input.ExclusiveStartKey === undefined ? { Items: [ROW], LastEvaluatedKey: KEY } : { Items: [{ ...ROW, senderEmail: "other@news.test" }] },
		);
		const jobs = await backfills.listBackfillsByUserId(USER);
		assert.deepEqual(
			jobs.map((job) => job.senderEmail),
			["dan@tldr.tech", "other@news.test"],
		);
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":prefix"], "MARK_BACKFILL#");
		assert.equal(sent[0].input.ConsistentRead, true);
	});

	it("claims a page under a 60 second lease", async () => {
		const { backfills, sent } = store();
		assert.equal(await backfills.claimPage({ ...REF, generation: 2, page: 3, now: NOW }), true);
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":until"], NOW.getTime() + 60_000);
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":nowMs"], NOW.getTime());
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":generation"], 2);
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":page"], 3);
	});

	it("reports a lost claim", async () => {
		const { backfills } = store(() => {
			throw conditionFailed();
		});
		assert.equal(await backfills.claimPage({ ...REF, generation: 2, page: 3, now: NOW }), false);
	});

	it("saves a page by moving to the next page, keeping the cursor and adding the counts", async () => {
		const { backfills, sent } = store();
		const cursor = "2026-09-01T00:00:00.000Z#<b@tldr.tech>";
		assert.equal(await backfills.savePage({ ...REF, generation: 2, page: 3, cursor, counts: COUNTS, now: NOW }), true);
		const update = sent[0].input;
		assert.equal(
			update.UpdateExpression,
			"SET #page = :next, #cursor = :cursor, #counts.#marked = #counts.#marked + :add_marked, #counts.#alreadyMarked = #counts.#alreadyMarked + :add_alreadyMarked, #counts.#notFound = #counts.#notFound + :add_notFound, #counts.#unlocatable = #counts.#unlocatable + :add_unlocatable, #counts.#notSaved = #counts.#notSaved + :add_notSaved, #counts.#failed = #counts.#failed + :add_failed, updatedAt = :now REMOVE claimUntil",
		);
		assert.equal(update.ConditionExpression, "generation = :generation AND #page = :page AND #state = :running");
		assert.equal(update.ExpressionAttributeNames?.["#cursor"], "cursor");
		assert.equal(update.ExpressionAttributeValues?.[":next"], 4);
		assert.equal(update.ExpressionAttributeValues?.[":cursor"], cursor);
		assert.equal(update.ExpressionAttributeValues?.[":add_unlocatable"], 2);
	});

	it("completes a job on its current page and adds the last counts", async () => {
		const { backfills, sent } = store();
		assert.equal(await backfills.complete({ ...REF, generation: 2, page: 3, counts: COUNTS, now: NOW }), true);
		assert.match(String(sent[0].input.UpdateExpression), /^SET #state = :complete, finishedAt = :now, #counts\.#marked/);
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":complete"], "complete");
	});

	it("refuses to save a page that is no longer the job's current page", async () => {
		const { backfills } = store(() => {
			throw conditionFailed();
		});
		assert.equal(await backfills.complete({ ...REF, generation: 2, page: 3, counts: COUNTS, now: NOW }), false);
	});

	it("fails an unfinished job of the given generation", async () => {
		const { backfills, sent } = store();
		assert.equal(await backfills.failBackfill({ ...REF, generation: 2, reason: "dead-lettered", now: NOW }), "failed");
		assert.equal(sent[0].input.ConditionExpression, "generation = :generation AND #state IN (:queued, :running)");
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":generation"], 2);
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":reason"], "dead-lettered");
	});

	it("fails an unfinished job of any generation when none is given", async () => {
		const { backfills, sent } = store();
		assert.equal(await backfills.failBackfill({ ...REF, generation: undefined, reason: "permission-revoked", now: NOW }), "failed");
		assert.equal(sent[0].input.ConditionExpression, "#state IN (:queued, :running)");
		assert.deepEqual(Object.keys(sent[0].input.ExpressionAttributeValues ?? {}), [":failed", ":reason", ":now", ":queued", ":running"]);
	});

	it("leaves a finished job unchanged when a failure arrives", async () => {
		const { backfills } = store(() => {
			throw conditionFailed();
		});
		assert.equal(await backfills.failBackfill({ ...REF, generation: 2, reason: "dead-lettered", now: NOW }), "unchanged");
	});

	it("cancels an unfinished job of the given generation", async () => {
		const { backfills, sent } = store();
		assert.equal(await backfills.cancelBackfill({ ...REF, generation: 2, reason: "option-off", now: NOW }), "cancelled");
		assert.deepEqual(sent[0].input.Key, KEY);
		assert.equal(sent[0].input.ConditionExpression, "generation = :generation AND #state IN (:queued, :running)");
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":generation"], 2);
		assert.equal(sent[0].input.ExpressionAttributeValues?.[":reason"], "option-off");
	});

	it("cancels an unfinished job of any generation when none is given", async () => {
		const { backfills, sent } = store();
		assert.equal(await backfills.cancelBackfill({ ...REF, generation: undefined, reason: "option-off", now: NOW }), "cancelled");
		assert.equal(sent[0].input.ConditionExpression, "#state IN (:queued, :running)");
		assert.deepEqual(Object.keys(sent[0].input.ExpressionAttributeValues ?? {}), [":cancelled", ":reason", ":now", ":queued", ":running"]);
	});

	it("leaves a finished or missing job unchanged when it is cancelled", async () => {
		const { backfills } = store(() => {
			throw conditionFailed();
		});
		assert.equal(await backfills.cancelBackfill({ ...REF, generation: 2, reason: "mapping-removed", now: NOW }), "unchanged");
	});
});
