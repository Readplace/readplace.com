import { z } from "zod";

const ImportPageQuerySchema = z.looseObject({
	page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export function parseImportPage(query: Record<string, unknown>): number {
	const parsed = ImportPageQuerySchema.parse(query);
	return parsed.page ?? 1;
}

const ImportDailyLimitQuerySchema = z.looseObject({
	import_daily_limit: z.literal("1"),
	import_imported: z.coerce.number().int().min(0),
});

export function parseImportDailyLimitSavedCount(query: Record<string, unknown>): number | undefined {
	const parsed = ImportDailyLimitQuerySchema.safeParse(query);
	return parsed.success ? parsed.data.import_imported : undefined;
}

export function buildImportDailyLimitUrl(params: { sessionId: string; savedCount: number }): string {
	return `/import/${params.sessionId}?import_imported=${params.savedCount}&import_daily_limit=1`;
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
