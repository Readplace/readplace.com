import { z } from "zod";

/** 1. Stored on the per-user article row and parsed on every read of it, so the
 *     free-form arms stay `z.string()`: pinning them to the client registry (or
 *     to today's OAuth roster) would turn removing a client into a parse failure
 *     for every row already stamped with it. Producers get their narrowing from
 *     `clientNameForBuiltInOAuthClientId`, and the reader resolves an unknown
 *     name to a generic label. */
export const SaveProvenanceSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("web") }),
	z.object({ kind: z.literal("client"), clientName: z.string() }), /* 1 */
	z.object({ kind: z.literal("email"), senderEmail: z.string() }),
	z.object({ kind: z.literal("import") }),
	z.object({ kind: z.literal("mcp"), registeredName: z.string() }), /* 1 */
]);

export type SaveProvenance = z.infer<typeof SaveProvenanceSchema>;
