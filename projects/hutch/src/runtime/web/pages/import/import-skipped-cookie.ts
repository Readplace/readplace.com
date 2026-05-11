import { z } from "zod";
import type { SaveableUrlErrorCode } from "@packages/domain/article";

export const IMPORT_SKIPPED_COOKIE_NAME = "import_skipped";

const MAX_COOKIE_ITEMS = 20;

export interface ImportSkippedEntry {
	readonly url: string;
	readonly code: SaveableUrlErrorCode;
}

export interface ImportSkippedFlash {
	readonly entries: readonly ImportSkippedEntry[];
	readonly andMore: number;
}

const ImportSkippedFlashSchema = z.object({
	entries: z.array(
		z.object({
			url: z.string(),
			code: z.enum(["unsupported_scheme", "private_network", "malformed_url"]),
		}),
	),
	andMore: z.number().int().min(0),
});

export function encodeImportSkippedCookie(
	skipped: readonly ImportSkippedEntry[],
): string {
	const truncated = skipped.slice(0, MAX_COOKIE_ITEMS);
	const andMore = Math.max(0, skipped.length - truncated.length);
	const payload: ImportSkippedFlash = { entries: truncated, andMore };
	return encodeURIComponent(JSON.stringify(payload));
}

export function decodeImportSkippedCookie(
	raw: string | undefined,
): ImportSkippedFlash | undefined {
	if (!raw) return undefined;
	let decoded: unknown;
	try {
		decoded = JSON.parse(decodeURIComponent(raw));
	} catch {
		return undefined;
	}
	const parsed = ImportSkippedFlashSchema.safeParse(decoded);
	return parsed.success ? parsed.data : undefined;
}
