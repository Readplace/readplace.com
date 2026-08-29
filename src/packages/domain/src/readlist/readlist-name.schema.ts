import { z } from "zod";

export const READLIST_LABEL_MAX_LENGTH = 24;

export const READLIST_MAX_PER_USER = 7;

export const ReadlistLabelSchema = z.string().min(1).max(READLIST_LABEL_MAX_LENGTH);

export const ReadlistSlugSchema = z
	.string()
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
	.max(READLIST_LABEL_MAX_LENGTH)
	.brand<"ReadlistSlug">();

export type ReadlistSlug = z.infer<typeof ReadlistSlugSchema>;

export const DEFAULT_READLIST_SLUG: ReadlistSlug = ReadlistSlugSchema.parse("default");

export class ReadlistLimitReachedError extends Error {
	constructor(readonly limit: number) {
		super(`Readlist limit of ${limit} reached`);
		this.name = "ReadlistLimitReachedError";
	}
}

export function parseReadlistLabel(raw: string): string | undefined {
	const parsed = ReadlistLabelSchema.safeParse(raw.trim());
	return parsed.success ? parsed.data : undefined;
}
