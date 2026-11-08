import assert from "node:assert/strict";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/storage-client";
import { z } from "zod";
import { initAdvanceContentFetchedAt } from "./advance-content-fetched-at";

type SendFn = DynamoDBDocumentClient["send"];
type Row = { contentFetchedAt?: string; savedAt?: string; purgedAt?: string; bodyHash?: string };
type FenceCase = { name: string; before: Row; outcome: "advanced" | "superseded"; after: Row };
type SentCommand = { name: string; input: Record<string, unknown> };

const TABLE = "test-articles";
const T = "2026-05-10T12:00:00.000Z";
const URL_UNDER_TEST = "https://example.com/post";
const KEY = "example.com/post";

const UpdateInput = z.object({
	Key: z.object({ url: z.string() }),
	ExpressionAttributeValues: z.object({ ":cfa": z.string() }),
});

function fenceAdmits(row: Row | undefined, cfa: string): boolean {
	if (row === undefined) return false;
	if (row.purgedAt !== undefined) return false;
	if (row.contentFetchedAt !== undefined) return row.contentFetchedAt < cfa;
	return row.savedAt !== undefined && row.savedAt <= cfa;
}

function createFakeTable(initial: Row | undefined) {
	const rows = new Map<string, Row>();
	if (initial !== undefined) rows.set(KEY, { ...initial });
	const sent: SentCommand[] = [];
	const send = (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
		sent.push({ name: command.constructor.name, input: command.input });
		const { Key, ExpressionAttributeValues } = UpdateInput.parse(command.input);
		const cfa = ExpressionAttributeValues[":cfa"];
		const row = rows.get(Key.url);
		if (!fenceAdmits(row, cfa)) {
			throw new ConditionalCheckFailedException({ message: "refused", $metadata: {} });
		}
		rows.set(Key.url, { ...row, contentFetchedAt: cfa });
		return {};
	}) as SendFn;
	const { advanceContentFetchedAt } = initAdvanceContentFetchedAt({ client: { send }, tableName: TABLE });
	return { advanceContentFetchedAt, rows, sent };
}

describe("initAdvanceContentFetchedAt", () => {
	it("binds the fence to the row's own timestamps", async () => {
		const { advanceContentFetchedAt, sent } = createFakeTable({ contentFetchedAt: "2026-05-09T12:00:00.000Z" });

		await advanceContentFetchedAt({ url: URL_UNDER_TEST, contentFetchedAt: T });

		assert.equal(sent.length, 1);
		const [command] = sent;
		assert(command);
		expect(command.name).toBe("UpdateCommand");
		expect(command.input.TableName).toBe(TABLE);
		expect(command.input.Key).toEqual({ url: KEY });
		expect(command.input.UpdateExpression).toBe("SET contentFetchedAt = :cfa");
		expect(command.input.ExpressionAttributeValues).toEqual({ ":cfa": T });
		const condition = command.input.ConditionExpression;
		expect(condition).toContain("attribute_not_exists(purgedAt)");
		expect(condition).toContain("contentFetchedAt < :cfa");
		expect(condition).toContain("attribute_not_exists(contentFetchedAt)");
		expect(condition).toContain("savedAt <= :cfa");
	});

	it.each<FenceCase>([
		{
			name: "advances an older clock",
			before: { contentFetchedAt: "2026-05-09T12:00:00.000Z", bodyHash: "H2" },
			outcome: "advanced",
			after: { contentFetchedAt: T, bodyHash: "H2" },
		},
		{
			name: "refuses after a conflicting later commit",
			before: { contentFetchedAt: "2026-05-11T12:00:00.000Z", bodyHash: "H2" },
			outcome: "superseded",
			after: { contentFetchedAt: "2026-05-11T12:00:00.000Z", bodyHash: "H2" },
		},
		{
			name: "refuses a tombstone",
			before: { purgedAt: "2026-05-09T00:00:00.000Z" },
			outcome: "superseded",
			after: { purgedAt: "2026-05-09T00:00:00.000Z" },
		},
		{
			name: "refuses a revived row from before the purge",
			before: { savedAt: "2026-05-11T12:00:00.000Z" },
			outcome: "superseded",
			after: { savedAt: "2026-05-11T12:00:00.000Z" },
		},
		{
			name: "admits the first-save stamp",
			before: { savedAt: T },
			outcome: "advanced",
			after: { savedAt: T, contentFetchedAt: T },
		},
		{
			name: "stamps over an operator's epoch clock",
			before: { contentFetchedAt: "1970-01-01T00:00:00.000Z" },
			outcome: "advanced",
			after: { contentFetchedAt: T },
		},
	])("$name", async ({ before, outcome, after }) => {
		const { advanceContentFetchedAt, rows } = createFakeTable(before);

		const result = await advanceContentFetchedAt({ url: URL_UNDER_TEST, contentFetchedAt: T });

		expect(result).toBe(outcome);
		expect(rows.get(KEY)).toEqual(after);
	});

	it("run twice leaves the first write", async () => {
		const { advanceContentFetchedAt, rows } = createFakeTable({ contentFetchedAt: "2026-05-09T12:00:00.000Z" });

		const first = await advanceContentFetchedAt({ url: URL_UNDER_TEST, contentFetchedAt: T });
		const second = await advanceContentFetchedAt({ url: URL_UNDER_TEST, contentFetchedAt: T });

		expect([first, second]).toEqual(["advanced", "superseded"]);
		expect(rows.get(KEY)).toEqual({ contentFetchedAt: T });
	});

	it("creates no row for an absent key", async () => {
		const { advanceContentFetchedAt, rows } = createFakeTable(undefined);

		const result = await advanceContentFetchedAt({ url: URL_UNDER_TEST, contentFetchedAt: T });

		expect(result).toBe("superseded");
		expect(rows.has(KEY)).toBe(false);
	});

	it("rethrows a throttle so the record retries", async () => {
		const throttle = new Error("ProvisionedThroughputExceededException");
		const send = (async () => {
			throw throttle;
		}) as SendFn;
		const { advanceContentFetchedAt } = initAdvanceContentFetchedAt({ client: { send }, tableName: TABLE });

		await expect(advanceContentFetchedAt({ url: URL_UNDER_TEST, contentFetchedAt: T })).rejects.toBe(throttle);
	});
});
