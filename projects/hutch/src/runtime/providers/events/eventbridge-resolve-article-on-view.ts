import { ResolveArticleOnViewCommand } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { PublishResolveArticleOnView } from "@packages/provider-contracts/events";

export function initEventBridgeResolveArticleOnView(deps: {
	publishEvent: PublishEvent;
}): { publishResolveArticleOnView: PublishResolveArticleOnView } {
	return {
		publishResolveArticleOnView: (params) => deps.publishEvent(ResolveArticleOnViewCommand, params),
	};
}
