import { DEFAULT_QUEUE_SLUG, type QueueSlug } from "./queue-name.schema";

export type QueueMigrationRejection = "unknown-queue" | "same-queue";

export type QueueMigrationDecision =
	| { ok: true; from: QueueSlug; to: QueueSlug }
	| { ok: false; reason: QueueMigrationRejection };

export function decideQueueMigration(params: {
	from: QueueSlug;
	to: QueueSlug;
	queues: readonly { slug: QueueSlug; label: string }[];
}): QueueMigrationDecision {
	if (params.from === DEFAULT_QUEUE_SLUG) return { ok: false, reason: "unknown-queue" };
	if (params.to === DEFAULT_QUEUE_SLUG) return { ok: false, reason: "unknown-queue" };
	if (params.from === params.to) return { ok: false, reason: "same-queue" };
	const owns = (slug: QueueSlug) => params.queues.some((queue) => queue.slug === slug);
	if (!owns(params.from) || !owns(params.to)) return { ok: false, reason: "unknown-queue" };
	return { ok: true, from: params.from, to: params.to };
}
