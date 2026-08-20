import { z } from "zod";

export const QUEUE_LABEL_MAX_LENGTH = 24;

export const QUEUE_MAX_PER_USER = 7;

export const QueueLabelSchema = z.string().min(1).max(QUEUE_LABEL_MAX_LENGTH);

export const QueueSlugSchema = z
	.string()
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
	.max(QUEUE_LABEL_MAX_LENGTH)
	.brand<"QueueSlug">();

export type QueueSlug = z.infer<typeof QueueSlugSchema>;

export const DEFAULT_QUEUE_SLUG: QueueSlug = QueueSlugSchema.parse("default");

export class QueueLimitReachedError extends Error {
	constructor(readonly limit: number) {
		super(`Queue limit of ${limit} reached`);
		this.name = "QueueLimitReachedError";
	}
}

export function parseQueueLabel(raw: string): string | undefined {
	const parsed = QueueLabelSchema.safeParse(raw.trim());
	return parsed.success ? parsed.data : undefined;
}
