import { DEFAULT_QUEUE_SLUG, type QueueSlug } from "./queue-name.schema";

export type QueueDeleteRejection = "unknown-queue";

export type QueueDeleteDecision =
	| { ok: true; slug: QueueSlug }
	| { ok: false; reason: QueueDeleteRejection };

export function decideQueueDelete(params: {
	slug: QueueSlug;
	queues: readonly { slug: QueueSlug; label: string }[];
}): QueueDeleteDecision {
	if (params.slug === DEFAULT_QUEUE_SLUG) return { ok: false, reason: "unknown-queue" };
	if (!params.queues.some((queue) => queue.slug === params.slug)) {
		return { ok: false, reason: "unknown-queue" };
	}
	return { ok: true, slug: params.slug };
}
