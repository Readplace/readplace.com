import { DEFAULT_QUEUE_SLUG, type QueueSlug } from "@packages/domain/queue";

export interface Queue {
	slug: QueueSlug;
	label: string;
}

export const DEFAULT_QUEUE: Queue = { slug: DEFAULT_QUEUE_SLUG, label: "My Queue" };
