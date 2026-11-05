import assert from "node:assert/strict";
import { z } from "zod";
import { dynamoField } from "./dynamo-field";
import { assembleRowUpdate } from "./row-update";

const Row = z.object({
	url: z.string(),
	a: dynamoField(z.string()),
	b: dynamoField(z.number()),
	c: dynamoField(z.string()),
	x: dynamoField(z.string()),
});

describe("assembleRowUpdate", () => {
	it("renders typed SET entries in order, then REMOVE", () => {
		const update = assembleRowUpdate({
			schema: Row,
			set: { a: "alpha", b: 2 },
			remove: ["c"],
			handWrittenSet: { clauses: [], values: {} },
			condition: { kind: "upsert" },
		});

		assert.equal(update.UpdateExpression, "SET a = :a, b = :b REMOVE c");
		assert.deepEqual(update.ExpressionAttributeValues, { ":a": "alpha", ":b": 2 });
	});

	it("renders a null value as a SET that clears the column", () => {
		const update = assembleRowUpdate({
			schema: Row,
			set: { x: null },
			remove: [],
			handWrittenSet: { clauses: [], values: {} },
			condition: { kind: "upsert" },
		});

		assert.equal(update.UpdateExpression, "SET x = :x");
		assert.deepEqual(update.ExpressionAttributeValues, { ":x": null });
	});

	it("appends hand-written clauses after the typed ones and merges their values", () => {
		const update = assembleRowUpdate({
			schema: Row,
			set: { a: "alpha" },
			remove: [],
			handWrittenSet: {
				clauses: ["b = if_not_exists(b, :zero) + :one"],
				values: { ":zero": 0, ":one": 1 },
			},
			condition: { kind: "upsert" },
		});

		assert.equal(update.UpdateExpression, "SET a = :a, b = if_not_exists(b, :zero) + :one");
		assert.deepEqual(update.ExpressionAttributeValues, { ":a": "alpha", ":zero": 0, ":one": 1 });
	});

	it("conditions on the row existing", () => {
		const update = assembleRowUpdate({
			schema: Row,
			set: { a: "alpha" },
			remove: [],
			handWrittenSet: { clauses: [], values: {} },
			condition: { kind: "row-exists", attribute: "url" },
		});

		assert.equal(update.ConditionExpression, "attribute_exists(url)");
	});

	it("passes an expression condition through and merges its values", () => {
		const update = assembleRowUpdate({
			schema: Row,
			set: { a: "alpha" },
			remove: [],
			handWrittenSet: { clauses: [], values: {} },
			condition: { kind: "expression", expression: "b = :expected", values: { ":expected": 7 } },
		});

		assert.equal(update.ConditionExpression, "b = :expected");
		assert.deepEqual(update.ExpressionAttributeValues, { ":a": "alpha", ":expected": 7 });
	});

	it("leaves the condition out of an upsert", () => {
		const update = assembleRowUpdate({
			schema: Row,
			set: { a: "alpha" },
			remove: [],
			handWrittenSet: { clauses: [], values: {} },
			condition: { kind: "upsert" },
		});

		expect(update).toStrictEqual({
			UpdateExpression: "SET a = :a",
			ExpressionAttributeValues: { ":a": "alpha" },
		});
	});

	it("does not compile a column the schema does not declare", () => {
		const update = assembleRowUpdate({
			schema: Row,
			// @ts-expect-error
			set: { unknownColumn: "value" },
			remove: [],
			handWrittenSet: { clauses: [], values: {} },
			condition: { kind: "upsert" },
		});

		assert.equal(update.UpdateExpression, "SET unknownColumn = :unknownColumn");
	});

	it("refuses a column that is both set and removed", () => {
		assert.throws(() =>
			assembleRowUpdate({
				schema: Row,
				set: { a: "alpha" },
				remove: ["a"],
				handWrittenSet: { clauses: [], values: {} },
				condition: { kind: "upsert" },
			}),
		);
	});
});
