import { z } from "zod";

const ImportPageQuerySchema = z
	.object({
		page: z.coerce.number().int().min(1).optional().catch(undefined),
	})
	.passthrough();

export function parseImportPage(query: Record<string, unknown>): number {
	const parsed = ImportPageQuerySchema.parse(query);
	return parsed.page ?? 1;
}

export function buildImportUrl(sessionId: string, page: number): string {
	return page > 1 ? `/import/${sessionId}?page=${page}` : `/import/${sessionId}`;
}

export function buildImportToggleUrl(sessionId: string, page: number): string {
	const base = `/import/${sessionId}/toggle`;
	return page > 1 ? `${base}?page=${page}` : base;
}

export function buildImportToggleAllUrl(sessionId: string, page: number): string {
	const base = `/import/${sessionId}/toggle-all`;
	return page > 1 ? `${base}?page=${page}` : base;
}
