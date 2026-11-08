import type { GmailConnectionStore } from "@packages/domain/gmail";
import type { RewriteGmailFilter } from "./rewrite-gmail-filter";

export function initRewriteGmailFilterUnlessDisconnecting(deps: {
	connections: Pick<GmailConnectionStore, "findConnectionByUserId">;
	rewriteGmailFilter: RewriteGmailFilter;
}): RewriteGmailFilter {
	const { connections, rewriteGmailFilter } = deps;

	return async ({ userId }) => {
		const connection = await connections.findConnectionByUserId(userId);
		if (connection?.disconnectRequestedAt !== undefined) return { ok: false, reason: "not-connected" };
		return rewriteGmailFilter({ userId });
	};
}
