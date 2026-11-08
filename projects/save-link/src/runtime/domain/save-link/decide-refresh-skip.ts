import type { RefreshArticleContentSkipReason } from "@packages/infra-components";

export type RefreshAdmissionRow = {
	purgedAt?: string;
	contentFetchedAt?: string;
	savedAt?: string;
	crawlStatus?: string;
};

export type FindRefreshAdmissionRow = (url: string) => Promise<RefreshAdmissionRow | undefined>;

export function decideRefreshSkip(input: {
	row: RefreshAdmissionRow | undefined;
	messageFetchedAt: string;
}): RefreshArticleContentSkipReason | undefined {
	const { row, messageFetchedAt } = input;
	if (row === undefined) return undefined;
	if (row.purgedAt !== undefined) return "purged";
	if (row.crawlStatus === "unsupported") return "unsupported";
	if (row.contentFetchedAt) return row.contentFetchedAt >= messageFetchedAt ? "superseded" : undefined;
	if (row.savedAt !== undefined && row.savedAt > messageFetchedAt) return "superseded";
	return undefined;
}
