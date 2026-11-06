import type { Logger } from "@packages/logger";
import type { PublishRemoveMyContent } from "@packages/provider-contracts/events";

export function initInMemoryRemoveMyContent(deps: {
	logger: Logger;
}): { publishRemoveMyContent: PublishRemoveMyContent } {
	const { logger } = deps;

	const publishRemoveMyContent: PublishRemoveMyContent = async (params) => {
		logger.info("[RemoveMyContent] command published (in-memory no-op)", {
			url: params.url,
			userId: params.userId,
			versionMinuteId: params.versionMinuteId,
		});
	};

	return { publishRemoveMyContent };
}
