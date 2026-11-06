import assert from "node:assert";
import type { z } from "zod";

type Column<TSchema extends z.ZodObject> = keyof z.input<TSchema> & string;

type RowUpdateCondition<TSchema extends z.ZodObject> =
	| { kind: "row-exists"; attribute: Column<TSchema> }
	| { kind: "expression"; expression: string; values: Record<string, unknown> }
	| { kind: "upsert" };

type RowUpdate = {
	UpdateExpression: string;
	ExpressionAttributeValues: Record<string, unknown>;
	ConditionExpression?: string;
};

export function assembleRowUpdate<TSchema extends z.ZodObject>(input: {
	schema: TSchema;
	set: Partial<z.input<TSchema>>;
	remove: readonly Column<TSchema>[];
	handWrittenSet: { clauses: readonly string[]; values: Record<string, unknown> };
	condition: RowUpdateCondition<TSchema>;
}): RowUpdate {
	const { set, remove, handWrittenSet, condition } = input;
	const setEntries = Object.entries(set);
	const setColumns = new Set<string>(setEntries.map(([column]) => column));
	const overlap = remove.filter((column) => setColumns.has(column));
	assert(overlap.length === 0, `Columns both set and removed: ${overlap.join(", ")}`);

	const setClauses = [
		...setEntries.map(([column]) => `${column} = :${column}`),
		...handWrittenSet.clauses,
	];
	const removeClause = remove.length > 0 ? ` REMOVE ${remove.join(", ")}` : "";
	const typedValues = Object.fromEntries(
		setEntries.map(([column, value]) => [`:${column}`, value]),
	);
	const conditionValues = condition.kind === "expression" ? condition.values : {};
	const conditionExpression =
		condition.kind === "row-exists"
			? `attribute_exists(${condition.attribute})`
			: condition.kind === "expression"
				? condition.expression
				: undefined;

	return {
		UpdateExpression: `SET ${setClauses.join(", ")}${removeClause}`,
		ExpressionAttributeValues: {
			...typedValues,
			...handWrittenSet.values,
			...conditionValues,
		},
		...(conditionExpression === undefined ? {} : { ConditionExpression: conditionExpression }),
	};
}
