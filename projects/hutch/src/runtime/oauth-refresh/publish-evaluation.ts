import type { Logger } from "@packages/logger";
import type { RefreshCounts } from "./outcomes";

export function initPublishRefreshEvaluation(deps: {
	publish: (input: { minute: number; counts: RefreshCounts }) => Promise<void>;
	logger: Logger;
}) {
	return async (input: { minute: number; counts: RefreshCounts }) => {
		await deps.publish(input);
		deps.logger.info(JSON.stringify({ event: "oauth_refresh_evaluated", minute: input.minute, ...input.counts }));
	};
}
