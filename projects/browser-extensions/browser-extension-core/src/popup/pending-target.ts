import "../zod-config";
import { z } from "zod";

export type PendingTarget = { url: string; title: string; tabId?: number };

const StoredPendingTargetSchema = z.object({
	url: z.string(),
	title: z.string().optional().catch(undefined),
	tabId: z.number().optional().catch(undefined),
});

export function parsePendingTarget(raw: unknown): PendingTarget | null {
	const stored = StoredPendingTargetSchema.safeParse(raw);
	if (!stored.success) return null;
	const target: PendingTarget = { url: stored.data.url, title: stored.data.title ?? stored.data.url };
	if (stored.data.tabId !== undefined) target.tabId = stored.data.tabId;
	return target;
}
