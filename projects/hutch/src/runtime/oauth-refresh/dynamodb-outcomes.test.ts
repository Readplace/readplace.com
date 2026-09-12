import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { z } from "zod";
import { initDynamoRefreshOutcomes } from "./dynamodb-outcomes";
import { RefreshAttempt } from "./evidence";
import { initEvaluateRefreshOutcomes } from "./outcomes";

const keySchema = z.object({ day: z.string(), order: z.string() });
const commandSchema = z.object({
	Key: keySchema.optional(),
	UpdateExpression: z.string().optional(),
	ExpressionAttributeValues: z.record(z.string(), z.unknown()),
	ExclusiveStartKey: keySchema.optional(),
	ConsistentRead: z.boolean().optional(),
});

function setup() {
	const rows = new Map<string, Record<string, unknown>>();
	const controls: { failQueryAt?: number; writeFailure?: Error } = {};
	const queries: z.infer<typeof commandSchema>[] = [];
	const send = jest.fn().mockImplementation(async (command: { input: unknown }) => {
		const input = commandSchema.parse(command.input);
		const values = input.ExpressionAttributeValues;
		if (input.UpdateExpression) {
			if (controls.writeFailure) throw controls.writeFailure;
			assert(input.Key);
			const key = `${input.Key.day}#${input.Key.order}`;
			const row: Record<string, unknown> = { ...rows.get(key), ...input.Key };
			for (const assignment of input.UpdateExpression.matchAll(/(\w+) = (if_not_exists\((\w+), (:\w+)\)|(:\w+))/g)) {
				const [, field, , retainedField, retainedValue, assignedValue] = assignment;
				assert(field);
				if (retainedField) {
					assert(retainedValue);
					if (!(retainedField in row)) row[field] = values[retainedValue];
				} else {
					assert(assignedValue);
					row[field] = values[assignedValue];
				}
			}
			rows.set(key, row);
			return {};
		}
		queries.push(input);
		if (queries.length === controls.failQueryAt) throw new Error("query unavailable");
		const matching = [...rows.values()].filter(row => row.day === values[":day"] && String(row.order) >= String(values[":from"]) && String(row.order) <= String(values[":until"]) && (!input.ExclusiveStartKey || String(row.order) > input.ExclusiveStartKey.order)).sort((a, b) => String(a.order).localeCompare(String(b.order)));
		const page = matching.slice(0, 1);
		return { Items: page, LastEvaluatedKey: matching.length > 1 ? { day: page[0]?.day, order: page[0]?.order } : undefined };
	});
	const client: Partial<DynamoDBDocumentClient> = { send };
	return { store: initDynamoRefreshOutcomes({ client: client as DynamoDBDocumentClient, tableName: "outcomes" }), controls, queries };
}

it("preserves recovery delivered before refusal and does not inflate duplicate outcomes", async () => {
	const { store } = setup();
	const attempt = RefreshAttempt.parse({ refusalId: "first", occurredAt: Date.parse("2026-09-11T12:00:00Z"), fingerprint: "fingerprint" });
	const refusal = { ...attempt, reason: "unknown", status: 400 };
	const evaluate = initEvaluateRefreshOutcomes({ readDay: store.readDay, testGrants: [], publish: async () => {} });
	await store.recover(attempt, attempt.occurredAt + 1000);
	expect(await evaluate(attempt.occurredAt + 360_000)).toMatchObject({ raw: 0, recovered: 0, unexpected: 0 });
	await store.refuse(refusal);
	await store.refuse({ ...refusal, status: 503 });
	await store.recover(attempt, attempt.occurredAt + 2000);
	const rows = await store.readDay({ day: "2026-09-11", from: attempt.occurredAt, until: attempt.occurredAt + 360_000 });
	expect(rows).toEqual([{
		day: "2026-09-11", order: `${attempt.occurredAt}#${attempt.refusalId}`,
		expiresAt: attempt.occurredAt / 1000 + 31 * 86400,
		refusal, recoveredAt: attempt.occurredAt + 1000,
	}]);
	expect(await evaluate(attempt.occurredAt + 360_000)).toMatchObject({ raw: 1, recovered: 1, unexpected: 0 });
});

it("strongly consistently reads every page within the original refusal interval", async () => {
	const { store, queries } = setup();
	const occurredAt = Date.parse("2026-09-11T12:00:00Z");
	for (const offset of [-1, 0, 1, 2, 3]) {
		const attempt = RefreshAttempt.parse({ refusalId: String(offset), occurredAt: occurredAt + offset, fingerprint: "fingerprint" });
		await store.refuse({ ...attempt, reason: "unknown", status: 400 });
	}
	const rows = await store.readDay({ day: "2026-09-11", from: occurredAt, until: occurredAt + 2 });
	expect(rows.map(row => row.refusal?.occurredAt)).toEqual([occurredAt, occurredAt + 1, occurredAt + 2]);
	expect(queries.map(query => query.ConsistentRead)).toEqual([true, true, true]);
	expect(queries.slice(1).map(query => query.ExclusiveStartKey)).toEqual(rows.slice(0, 2).map(({ day, order }) => ({ day, order })));
});

it.each([1, 2])("propagates a failed query page %s and does not publish a partial evaluation", async page => {
	const { store, controls, queries } = setup();
	const occurredAt = Date.parse("2026-09-11T12:00:00Z");
	for (const refusalId of ["first", "second"]) {
		const attempt = RefreshAttempt.parse({ refusalId, occurredAt, fingerprint: "fingerprint" });
		await store.refuse({ ...attempt, reason: "unknown", status: 400 });
	}
	controls.failQueryAt = page;
	await expect(store.readDay({ day: "2026-09-11", from: occurredAt, until: occurredAt })).rejects.toThrow("query unavailable");
	queries.length = 0;
	controls.failQueryAt = page + 1;
	const publish = jest.fn().mockResolvedValue(undefined);
	const evaluate = initEvaluateRefreshOutcomes({ readDay: store.readDay, testGrants: [], publish });
	await expect(evaluate(occurredAt + 360_000)).rejects.toThrow("query unavailable");
	expect(publish.mock.calls).toEqual([]);
});

it("propagates refusal and recovery write failures to their delivery retry paths", async () => {
	const { store, controls } = setup();
	const attempt = RefreshAttempt.parse({ refusalId: "first", occurredAt: Date.parse("2026-09-11T12:00:00Z"), fingerprint: "fingerprint" });
	const failure = new Error("write unavailable");
	controls.writeFailure = failure;
	await expect(store.recover(attempt, attempt.occurredAt + 1000)).rejects.toBe(failure);
	await expect(store.refuse({ ...attempt, reason: "unknown", status: 400 })).rejects.toBe(failure);
});
