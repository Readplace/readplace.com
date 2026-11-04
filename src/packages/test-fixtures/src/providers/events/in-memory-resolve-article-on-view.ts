import type { Logger } from "@packages/logger";
import type { PublishResolveArticleOnView } from "@packages/provider-contracts/events";

export type ResolveArticleOnViewRecord = Parameters<PublishResolveArticleOnView>[0];

export function initInMemoryResolveArticleOnView(deps: {
	logger: Logger;
}): {
	publishResolveArticleOnView: PublishResolveArticleOnView;
	publishedResolveArticleOnView: ResolveArticleOnViewRecord[];
} {
	const { logger } = deps;
	const publishedResolveArticleOnView: ResolveArticleOnViewRecord[] = [];

	const publishResolveArticleOnView: PublishResolveArticleOnView = async (params) => {
		publishedResolveArticleOnView.push(params);
		logger.info("[ResolveArticleOnView] command published (in-memory no-op)", {
			url: params.url,
			axes: params.axes,
			surface: params.surface,
		});
	};

	return { publishResolveArticleOnView, publishedResolveArticleOnView };
}
