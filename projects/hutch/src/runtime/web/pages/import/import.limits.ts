import { MAX_IMPORT_FILE_BYTES, MAX_URLS_PER_IMPORT } from "@packages/domain/import-session";

export const IMPORT_LIMITS = {
	maxLinks: MAX_URLS_PER_IMPORT.toLocaleString("en-US"),
	maxFileSize: `${Math.floor(MAX_IMPORT_FILE_BYTES / 100_000) / 10} MB`,
} as const;
