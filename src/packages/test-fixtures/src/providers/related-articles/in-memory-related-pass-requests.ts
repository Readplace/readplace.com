import type { UserId } from "@packages/domain/user";
import type {
	MarkRelatedPassesRequested,
	MarkRelatedPassesRequestedOutcome,
	ReadPastReadsState,
	ReadRelatedPassRequestState,
} from "@packages/provider-contracts/related-articles";

export function initInMemoryRelatedPassRequests(deps: {
	readSavedRowRelatedRequest: (params: {
		userId: UserId;
		url: string;
	}) => Promise<{ requestedAt?: Date } | undefined>;
	stampRelatedPassesRequested: (params: {
		userId: UserId;
		url: string;
		at: Date;
	}) => Promise<MarkRelatedPassesRequestedOutcome>;
	readSettledNextRead: (params: { userId: UserId; url: string }) => "ready" | "skipped" | undefined;
	readPastReadsState: ReadPastReadsState;
	now: () => Date;
}): {
	readRelatedPassRequestState: ReadRelatedPassRequestState;
	markRelatedPassesRequested: MarkRelatedPassesRequested;
} {
	const readRelatedPassRequestState: ReadRelatedPassRequestState = async (params) => {
		const row = await deps.readSavedRowRelatedRequest(params);
		if (row === undefined) return { saved: false };
		const nextRead = deps.readSettledNextRead(params);
		const { computedAt } = await deps.readPastReadsState(params);
		return {
			saved: true,
			...(row.requestedAt !== undefined ? { requestedAt: row.requestedAt } : {}),
			...(nextRead !== undefined ? { nextRead } : {}),
			...(computedAt !== undefined ? { pastReadsComputedAt: computedAt } : {}),
		};
	};

	const markRelatedPassesRequested: MarkRelatedPassesRequested = (params) =>
		deps.stampRelatedPassesRequested({ ...params, at: deps.now() });

	return { readRelatedPassRequestState, markRelatedPassesRequested };
}
