/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import { ComputeRelatedArticlesCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { PublishComputeRelatedArticles } from "@packages/provider-contracts/events";

export function initEventBridgeComputeRelatedArticles(deps: {
	publishEvent: PublishEvent;
}): { publishComputeRelatedArticles: PublishComputeRelatedArticles } {
	return {
		publishComputeRelatedArticles: (params) =>
			deps.publishEvent(ComputeRelatedArticlesCommand, params),
	};
}
/* c8 ignore stop */
