import { z } from "zod";

const HandoffQuerySchema = z.object({
	code: z.string().min(1).max(256).optional(),
	state: z.string().min(1).max(512).optional(),
	error: z
		.string()
		.regex(/^[a-z][a-z_]{0,63}$/)
		.optional(),
});

export type ObsidianHandoff =
	| { kind: "code"; code: string; state: string | undefined }
	| { kind: "error"; error: string; state: string | undefined }
	| { kind: "invalid" };

const OBSIDIAN_AUTH_PROTOCOL_URL = "obsidian://readplace-auth";

export function parseObsidianHandoffQuery(query: unknown): ObsidianHandoff {
	const parsed = HandoffQuerySchema.safeParse(query);
	if (!parsed.success) return { kind: "invalid" };
	const { code, state, error } = parsed.data;
	if (code !== undefined) return { kind: "code", code, state };
	if (error !== undefined) return { kind: "error", error, state };
	return { kind: "invalid" };
}

export function obsidianHandoffHref(handoff: Exclude<ObsidianHandoff, { kind: "invalid" }>): string {
	const params = new URLSearchParams(handoff.kind === "code" ? { code: handoff.code } : { error: handoff.error });
	if (handoff.state !== undefined) params.set("state", handoff.state);
	return `${OBSIDIAN_AUTH_PROTOCOL_URL}?${params}`;
}
