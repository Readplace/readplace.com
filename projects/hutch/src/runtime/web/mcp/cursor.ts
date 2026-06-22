import { z } from "zod";
import type { ArticleStatus } from "@packages/domain/article";
import type {
	SortField,
	SortOrder,
} from "@packages/provider-contracts/article-store";

/**
 * The state carried across `list_queue` pages. The MCP layer exposes only an
 * opaque `nextCursor` token; this is what that token wraps so a follow-up call
 * resumes the same filter/sort at the next page over the store's offset
 * pagination. `sort` is the store-level field name, so a decoded cursor passes
 * straight to `findArticlesByUser` without re-mapping.
 */
export interface QueueCursor {
	readonly page: number;
	readonly pageSize: number;
	readonly status?: ArticleStatus;
	readonly sort?: SortField;
	readonly order?: SortOrder;
}

const QueueCursorSchema = z
	.object({
		page: z.number().int().min(1),
		pageSize: z.number().int().min(1).max(100),
		status: z.enum(["unread", "read"]).optional(),
		sort: z.enum(["savedAt", "readAt"]).optional(),
		order: z.enum(["asc", "desc"]).optional(),
	})
	.refine((c) => !(c.sort === "readAt" && c.status !== "read"), {
		message: 'sort:"readAt" requires status:"read"',
	});

export function encodeQueueCursor(cursor: QueueCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Decode a token produced by {@link encodeQueueCursor}. Returns `null` for any
 * token that doesn't base64url-decode to JSON of the expected shape — a forged,
 * truncated, or stale cursor, or one that pairs `sort:"readAt"` with a non-read
 * status (a pairing the mint-time guard never produces, so its presence means
 * tampering) — so the caller can ask the agent to restart from the first page
 * instead of trusting attacker-controlled pagination. */
export function decodeQueueCursor(token: string): QueueCursor | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	const result = QueueCursorSchema.safeParse(parsed);
	return result.success ? result.data : null;
}
