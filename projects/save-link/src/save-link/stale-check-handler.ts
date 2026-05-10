import type { SQSHandler } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import { StaleCheckRequestedEvent } from "@packages/hutch-infra-components";
import type { RefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type { PublishSaveAnonymousLink } from "@packages/test-fixtures/providers/events";

export function initStaleCheckHandler(deps: {
	refreshArticleIfStale: RefreshArticleIfStale;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	logger: HutchLogger;
}): SQSHandler {
	const { refreshArticleIfStale, publishSaveAnonymousLink, logger } = deps;

	return async (event) => {
		for (const record of event.Records) {
			const envelope = JSON.parse(record.body);
			const detail = StaleCheckRequestedEvent.detailSchema.parse(envelope.detail);

			logger.info("[StaleCheckRequested] processing", { url: detail.url });

			const result = await refreshArticleIfStale({ url: detail.url });

			if (result.action === "reprime" || result.action === "new") {
				await publishSaveAnonymousLink({ url: detail.url });
				logger.info("[StaleCheckRequested] re-published SaveAnonymousLinkCommand", {
					url: detail.url,
					action: result.action,
				});
			} else {
				logger.info("[StaleCheckRequested] no-op", {
					url: detail.url,
					action: result.action,
				});
			}
		}
	};
}
