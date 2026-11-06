import type { z } from "zod";

/**
 * Marks a Zod schema as an optional DynamoDB attribute. DynamoDB stores
 * missing attributes as `null`, not `undefined`, so plain `.optional()`
 * throws a ZodError when the attribute is absent. This wrapper accepts
 * both `null` and `undefined` and normalizes them to `undefined`.
 *
 * The returned schema carries a `__dynamoField` brand so that
 * `defineDynamoTable` can refuse plain `.optional()` schemas at compile time.
 */
export function dynamoField<T extends z.ZodTypeAny>(schema: T) {
	const wrapped = schema.nullish().transform((v) => v ?? undefined);
	return Object.assign(wrapped, { __dynamoField: true as const });
}

export type DynamoFieldSchema = z.ZodTypeAny & { readonly __dynamoField: true };
