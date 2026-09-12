import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { OAuthRefreshEvaluatedEvent } from "@packages/hutch-infra-components";
import type { RefreshCounts } from "./outcomes";

export function initPublishRefreshEvaluation(deps: {
	publish: (input: { minute: number; counts: RefreshCounts }) => Promise<void>;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}) {
	return async (input: { minute: number; counts: RefreshCounts }) => {
		await deps.publish(input);
		await deps.publishEvent(OAuthRefreshEvaluatedEvent, input);
		deps.logger.info(JSON.stringify({ event: "oauth_refresh_evaluated", minute: input.minute, ...input.counts }));
	};
}
