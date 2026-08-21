import { nextAvailableQueueLabel } from "./next-available-queue-label";
import { DEFAULT_QUEUE_SLUG, type QueueSlug, parseQueueLabel } from "./queue-name.schema";

export type QueueRenameRejection = "unknown-queue" | "invalid-name" | "name-taken";

export type QueueRenameDecision =
	| { ok: true; slug: QueueSlug; label: string }
	| { ok: false; reason: QueueRenameRejection };

export function decideQueueRename(params: {
	slug: QueueSlug;
	label: string;
	queues: readonly { slug: QueueSlug; label: string }[];
}): QueueRenameDecision {
	if (params.slug === DEFAULT_QUEUE_SLUG) return { ok: false, reason: "unknown-queue" };
	if (!params.queues.some((queue) => queue.slug === params.slug)) {
		return { ok: false, reason: "unknown-queue" };
	}
	const typed = parseQueueLabel(params.label);
	if (!typed) return { ok: false, reason: "invalid-name" };
	const numbered = nextAvailableQueueLabel({
		label: typed,
		takenLabels: params.queues
			.filter((queue) => queue.slug !== params.slug)
			.map((queue) => queue.label),
	});
	const label = parseQueueLabel(numbered);
	if (!label) return { ok: false, reason: "name-taken" };
	return { ok: true, slug: params.slug, label };
}
