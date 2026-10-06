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
	z.object({ kind: z.literal("founder-seed") }),
	z.object({
		kind: z.literal("hn-suggestion"),
		campaignId: z.string(),
		snapshotAt: z.string(),
		hnItemId: z.number(),
		rank: z.number(),
	}),
]);

export const SuggestionAttributionSchema = z.object({
	campaignId: z.string(),
	snapshotAt: z.string(),
	hnItemId: z.number(),
	rank: z.number(),
});
export type SuggestionAttribution = z.infer<typeof SuggestionAttributionSchema>;

export type SaveProvenance = z.infer<typeof SaveProvenanceSchema>;
