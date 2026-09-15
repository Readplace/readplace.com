import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { DisconnectGmail } from "./disconnect-gmail";
import type { RewriteGmailFilter } from "./rewrite-gmail-filter";

export function initLocalGmailCommands(deps: {
	rewriteGmailFilter: RewriteGmailFilter;
	disconnectGmail: DisconnectGmail;
	logger: HutchLogger;
}): {
	publishRewriteGmailFilter: (input: {
		userId: UserId;
		reason: "forwarding-confirmed" | "sender-added" | "sender-removed";
	}) => Promise<void>;
	publishDisconnectGmail: (input: { userId: UserId }) => Promise<void>;
} {
	const { rewriteGmailFilter, disconnectGmail, logger } = deps;

	return {
		publishRewriteGmailFilter: async ({ userId, reason }) => {
			const result = await rewriteGmailFilter({ userId });
			if (result.ok) {
				logger.info("[rewrite-gmail-filter] filter reconciled", {
					userId,
					filterCount: result.filterCount,
					senderCount: result.senderCount,
					reason,
				});
				return;
			}
			if (result.reason === "unavailable") {
				logger.warn("[rewrite-gmail-filter] gmail unavailable", { userId, status: result.status });
				return;
			}
			logger.error("[rewrite-gmail-filter] filter not written", { userId, reason: result.reason });
		},
		publishDisconnectGmail: async ({ userId }) => {
			const result = await disconnectGmail({ userId });
			if (result.ok) {
				logger.info("[disconnect-gmail] disconnected", {
					userId,
					filterRemoved: result.filterRemoved,
					grantRevoked: result.grantRevoked,
				});
				return;
			}
			if (result.reason === "unavailable") {
				logger.warn("[disconnect-gmail] google unavailable", { userId });
				return;
			}
			logger.warn("[disconnect-gmail] nothing to disconnect", { userId });
		},
	};
}
