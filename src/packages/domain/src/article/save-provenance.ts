import { z } from "zod";

export const SuggestionAttributionSchema = z.object({
	campaignId: z.string(),
	snapshotAt: z.string(),
	hnItemId: z.number(),
	rank: z.number(),
});
export type SuggestionAttribution = z.infer<typeof SuggestionAttributionSchema>;

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
	z.object({ kind: z.literal("upload") }),
	z.object({ kind: z.literal("mcp"), registeredName: z.string() }), /* 1 */
	z.object({ kind: z.literal("founder-seed") }),
	SuggestionAttributionSchema.extend({ kind: z.literal("hn-suggestion") }),
]);

export type SaveProvenance = z.infer<typeof SaveProvenanceSchema>;

type SaveProvenanceKind = SaveProvenance["kind"];

const KEPT_AGAINST_AUTOMATIC_SAVE: Record<SaveProvenanceKind, boolean> = {
	web: true,
	client: true,
	email: false,
	import: true,
	upload: true,
	mcp: true,
	"founder-seed": false,
	"hn-suggestion": false,
};

export const PROVENANCE_KINDS_KEPT_AGAINST_AUTOMATIC_SAVE: readonly SaveProvenanceKind[] = SaveProvenanceSchema.options
	.map((option) => option.shape.kind.value)
	.filter((kind) => KEPT_AGAINST_AUTOMATIC_SAVE[kind]);

export const keepsProvenanceAgainstAutomaticSave = (kind: SaveProvenanceKind | undefined): boolean =>
	kind === undefined || KEPT_AGAINST_AUTOMATIC_SAVE[kind];
