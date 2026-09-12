import { z } from "zod";
import type { ArticleStatus } from "@packages/domain/article";
import {
	type ReadlistSlug,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import type {
	SortField,
	SortOrder,
} from "@packages/provider-contracts/article-store";

export interface ReadlistCursor {
	readonly page: number;
	readonly pageSize: number;
	readonly scope?: "combined";
	readonly readlist?: ReadlistSlug;
	readonly status?: ArticleStatus;
	readonly sort?: SortField;
	readonly order?: SortOrder;
}

const ReadlistCursorSchema = z
	.object({
		page: z.number().int().min(1),
		pageSize: z.number().int().min(1).max(100),
		scope: z.literal("combined").optional(),
		readlist: ReadlistSlugSchema.optional(),
		status: z.enum(["unread", "read"]).optional(),
		sort: z.enum(["savedAt", "readAt"]).optional(),
		order: z.enum(["asc", "desc"]).optional(),
	})
	.refine((c) => !(c.sort === "readAt" && c.status !== "read"), {
		message: 'sort:"readAt" requires status:"read"',
	})
	.refine((c) => !(c.scope === "combined" && c.readlist !== undefined), {
		message: 'scope:"combined" cannot also name a readlist',
	});

export function encodeReadlistCursor(cursor: ReadlistCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeReadlistCursor(token: string): ReadlistCursor | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	const result = ReadlistCursorSchema.safeParse(parsed);
	return result.success ? result.data : null;
}
