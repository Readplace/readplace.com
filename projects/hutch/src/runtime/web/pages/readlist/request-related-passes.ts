import type { UserId } from "@packages/domain/user";
import type {
	PublishComputeRelatedPasses,
	PublishComputeRelatedPastReads,
} from "@packages/provider-contracts/events";
import type {
	MarkRelatedPassesRequested,
	ReadRelatedPassRequestState,
} from "@packages/provider-contracts/related-articles";

export interface RequestRelatedPassesDependencies {
	readRelatedPassRequestState: ReadRelatedPassRequestState;
	markRelatedPassesRequested: MarkRelatedPassesRequested;
	publishComputeRelatedPasses: PublishComputeRelatedPasses;
	publishComputeRelatedPastReads: PublishComputeRelatedPastReads;
}

export function initRequestRelatedPasses(
	deps: RequestRelatedPassesDependencies,
): (params: { userId: UserId; url: string; readlist?: string }) => Promise<void> {
	return async function requestRelatedPasses(params) {
		const { userId, url } = params;
		const state = await deps.readRelatedPassRequestState({ userId, url });
		if (state.saved && state.nextRead === undefined && state.requestedAt === undefined) {
			await deps.publishComputeRelatedPasses({ url, userId });
			await deps.markRelatedPassesRequested({ userId, url });
			return;
		}
		await deps.publishComputeRelatedPastReads(params);
	};
}
