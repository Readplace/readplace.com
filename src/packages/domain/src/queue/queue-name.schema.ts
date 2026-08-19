import { z } from "zod";

export const QUEUE_LABEL_MAX_LENGTH = 24;

export const QUEUE_MAX_PER_USER = 12;

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

export interface NamedQueue {
	slug: QueueSlug;
	label: string;
}

function slugFromLabel(label: string): QueueSlug | undefined {
	const normalized = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, QUEUE_LABEL_MAX_LENGTH)
		.replace(/^-+|-+$/g, "");
	const parsed = QueueSlugSchema.safeParse(normalized);
	return parsed.success ? parsed.data : undefined;
}

export function parseQueueLabel(raw: string): NamedQueue | undefined {
	const parsedLabel = QueueLabelSchema.safeParse(raw.trim());
	if (!parsedLabel.success) return undefined;
	const slug = slugFromLabel(parsedLabel.data);
	if (!slug) return undefined;
	return { label: parsedLabel.data, slug };
}
