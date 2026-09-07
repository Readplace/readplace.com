import { z } from "zod";

export const READLIST_PURPOSE_MAX_LENGTH = 10_000;

export const ReadlistPurposeSchema = z.string().trim().min(1).max(READLIST_PURPOSE_MAX_LENGTH);

export function parseReadlistPurpose(raw: string): string | undefined {
	const parsed = ReadlistPurposeSchema.safeParse(raw);
	return parsed.success ? parsed.data : undefined;
}
