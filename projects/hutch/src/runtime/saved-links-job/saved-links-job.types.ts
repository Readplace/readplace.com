import type { SavedLinksJobCounts, SavedLinksJobId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { RunSavedLinksJobDetail } from "@packages/infra-components";

export type RecordProgress = (counts: SavedLinksJobCounts) => Promise<{ outcome: "recorded" } | { outcome: "stale" }>;

export type RunSavedLinksJobAction = (params: {
	userId: UserId;
	jobId: SavedLinksJobId;
	detail: RunSavedLinksJobDetail;
	counts: SavedLinksJobCounts;
	resumed: boolean;
	recordProgress: RecordProgress;
}) => Promise<{ outcome: "finished"; counts: SavedLinksJobCounts } | { outcome: "stale" }>;

export function chunksOf<T>(params: { items: readonly T[]; size: number }): T[][] {
	const chunks: T[][] = [];
	for (let start = 0; start < params.items.length; start += params.size) {
		chunks.push(params.items.slice(start, start + params.size));
	}
	return chunks;
}

export const SAVED_LINKS_JOB_CHUNK_SIZE = 10;
