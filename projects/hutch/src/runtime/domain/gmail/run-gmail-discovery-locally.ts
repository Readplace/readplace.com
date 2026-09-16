import type { GmailDiscoveryStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { type DiscoverGmailSenders, GMAIL_DISCOVERY_PAUSED_MESSAGE, initRunGmailDiscovery } from "./discover-gmail-senders";

export function initRunGmailDiscoveryLocally(deps: {
	discover: DiscoverGmailSenders;
	discovery: GmailDiscoveryStore;
	waitForNextPage: () => Promise<void>;
	logger: HutchLogger;
}): (input: { userId: UserId }) => Promise<void> {
	const run = initRunGmailDiscovery({ discover: deps.discover, waitForNextPage: deps.waitForNextPage });
	return async ({ userId }) => {
		try {
			await run({ userId });
		} catch (error) {
			const current = await deps.discovery.findDiscoveryByUserId(userId);
			if (current?.state === "running") {
				await deps.discovery.failDiscovery({ userId, generation: current.generation, error: GMAIL_DISCOVERY_PAUSED_MESSAGE });
			}
			deps.logger.error("[gmail-discovery] local run failed", { userId, error });
		}
	};
}
