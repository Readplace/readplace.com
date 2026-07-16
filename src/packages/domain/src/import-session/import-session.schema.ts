import { z } from "zod";
import { LAMBDA_SYNC_INVOKE_PAYLOAD_BYTES } from "../article/article.schema";

export const ImportSessionIdSchema = z
	.string()
	.regex(/^[a-f0-9]{32}$/)
	.brand<"ImportSessionId">();

export type ImportSessionId = z.infer<typeof ImportSessionIdSchema>;

export const ImportToggleSchema = z.object({
	index: z.coerce.number().int().min(0),
	checked: z.enum(["true", "false"]),
});

export const ImportToggleAllSchema = z.object({
	checked: z.enum(["true", "false"]),
});

const IMPORT_UPLOAD_HEADROOM_BYTES = 128 * 1024;

export const MAX_IMPORT_FILE_BYTES = (LAMBDA_SYNC_INVOKE_PAYLOAD_BYTES * 3) / 4 - IMPORT_UPLOAD_HEADROOM_BYTES;
export const MAX_URLS_PER_IMPORT = 2_000;
export const IMPORT_SESSION_TTL_SECONDS = 24 * 60 * 60;
export const IMPORT_PAGE_SIZE = 50;
export const IMPORT_COMMIT_CONCURRENCY = 25;
