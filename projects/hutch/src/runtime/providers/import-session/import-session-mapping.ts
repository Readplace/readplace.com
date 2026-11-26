import { dynamoField } from "@packages/storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { type ImportSession, ImportSessionIdSchema } from "@packages/domain/import-session";

export const SessionRow = z.object({
	sessionId: ImportSessionIdSchema,
	userId: dynamoField(UserIdSchema),
	createdAt: z.string(),
	expiresAt: z.number(),
	totalUrls: z.number().int().min(0),
	totalFoundInFile: z.number().int().min(0),
	truncated: z.boolean(),
	urls: z.array(z.string()),
	deselected: dynamoField(z.array(z.number().int())),
	allSelected: dynamoField(z.boolean()),
});

type SessionRowOutput = z.infer<typeof SessionRow>;

export type ImportSessionRow = Omit<SessionRowOutput, "deselected" | "allSelected"> &
	Partial<Pick<SessionRowOutput, "deselected" | "allSelected">>;

export function computeDeselected(params: {
	allSelected?: boolean;
	deselected?: number[];
	totalUrls: number;
}): Set<number> {
	const allSelected = params.allSelected ?? true;
	return allSelected
		? new Set(params.deselected ?? [])
		: new Set(Array.from({ length: params.totalUrls }, (_v, i) => i));
}

export function toImportSession(row: ImportSessionRow): ImportSession {
	return {
		id: row.sessionId,
		userId: row.userId,
		createdAt: row.createdAt,
		expiresAt: row.expiresAt,
		totalUrls: row.totalUrls,
		totalFound: row.totalFoundInFile,
		truncated: row.truncated,
		deselected: computeDeselected({
			allSelected: row.allSelected,
			deselected: row.deselected,
			totalUrls: row.totalUrls,
		}),
	};
}
