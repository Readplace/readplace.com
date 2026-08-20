import { DEFAULT_QUEUE_SLUG, type QueueSlug, parseQueueLabel } from "./queue-name.schema";

export type QueueRenameRejection = "unknown-queue" | "invalid-name";

export type QueueRenameDecision =
	| { ok: true; slug: QueueSlug; label: string }
	| { ok: false; reason: QueueRenameRejection };

export function decideQueueRename(params: {
	slug: QueueSlug;
	label: string;
	ownedSlugs: readonly QueueSlug[];
}): QueueRenameDecision {
	if (params.slug === DEFAULT_QUEUE_SLUG) return { ok: false, reason: "unknown-queue" };
	if (!params.ownedSlugs.includes(params.slug)) return { ok: false, reason: "unknown-queue" };
	const label = parseQueueLabel(params.label);
	if (!label) return { ok: false, reason: "invalid-name" };
	return { ok: true, slug: params.slug, label };
}
