import type { GmailDiscoveryStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { Logger } from "@packages/logger";
import { type DiscoverGmailSenders, GMAIL_DISCOVERY_PAUSED_MESSAGE } from "./discover-gmail-senders";

export function initRunGmailDiscoveryLocally(deps: {
	discover: DiscoverGmailSenders;
	discovery: GmailDiscoveryStore;
	waitForNextPage: () => Promise<void>;
	logger: Logger;
}): (input: { userId: UserId }) => Promise<void> {
	return async ({ userId }) => {
		try {
			let next = await deps.discover.start(userId);
			while (next !== undefined) {
				await deps.waitForNextPage();
				next = await deps.discover.page(next);
			}
		} catch (error) {
			const current = await deps.discovery.findDiscoveryByUserId(userId);
			if (current?.state === "running") {
				await deps.discovery.failDiscovery({ userId, generation: current.generation, error: GMAIL_DISCOVERY_PAUSED_MESSAGE });
			}
			deps.logger.error("[gmail-discovery] local run failed", { userId, error });
		}
	};
}
