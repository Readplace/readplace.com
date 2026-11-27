import type { z } from "zod";

/**
 * Marks a Zod schema as an optional DynamoDB attribute. DynamoDB stores
 * missing attributes as `null`, not `undefined`, so plain `.optional()`
 * throws a ZodError when the attribute is absent. This wrapper accepts
 * both `null` and `undefined` and normalizes them to `undefined`.
 */
export function dynamoField<T extends z.ZodTypeAny>(schema: T) {
	return schema.nullish().transform((v) => v ?? undefined);
}
