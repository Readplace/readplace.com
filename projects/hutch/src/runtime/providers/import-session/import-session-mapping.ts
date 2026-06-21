import type { ImportSession } from "@packages/domain/import-session";

export interface ImportSessionRow {
	sessionId: ImportSession["id"];
	userId: ImportSession["userId"];
	createdAt: string;
	expiresAt: number;
	totalUrls: number;
	totalFoundInFile: number;
	truncated: boolean;
	urls: string[];
	deselected?: number[];
	allSelected?: boolean;
}

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
