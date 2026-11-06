import { MAX_IMPORT_FILE_BYTES, MAX_URLS_PER_IMPORT } from "@packages/domain/import-session";
import { DEFAULT_LOCALE } from "@packages/translations/locale";

export const IMPORT_LIMITS = {
	maxLinks: MAX_URLS_PER_IMPORT.toLocaleString(DEFAULT_LOCALE),
	maxFileSize: `${Math.floor(MAX_IMPORT_FILE_BYTES / 100_000) / 10} MB`,
} as const;
