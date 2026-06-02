import { z } from "zod";
import { VisibleArticleStatusSchema } from "@packages/domain/article";

export const DELETE_UNDO_COOKIE_NAME = "delete_undo";

/** Short-lived: the toast is consumed on the very next /queue render (the 303
 * redirect that follows the delete). A small TTL keeps a stale "Link deleted"
 * toast from resurfacing if that render never happens (e.g. the tab is closed
 * mid-delete). */
export const DELETE_UNDO_COOKIE_MAX_AGE_MS = 60_000;

const DeleteUndoSchema = z.object({
	id: z.string(),
	previousStatus: VisibleArticleStatusSchema,
});

export type DeleteUndoFlash = z.infer<typeof DeleteUndoSchema>;

export function encodeDeleteUndoCookie(flash: DeleteUndoFlash): string {
	return encodeURIComponent(JSON.stringify(flash));
}

export function decodeDeleteUndoCookie(
	raw: string | undefined,
): DeleteUndoFlash | undefined {
	if (!raw) return undefined;
	let decoded: unknown;
	try {
		decoded = JSON.parse(decodeURIComponent(raw));
	} catch {
		return undefined;
	}
	const parsed = DeleteUndoSchema.safeParse(decoded);
	return parsed.success ? parsed.data : undefined;
}
