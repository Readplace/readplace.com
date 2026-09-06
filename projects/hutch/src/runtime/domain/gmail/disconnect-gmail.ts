import type {
	GmailConnectionStore,
	GmailCredentialsStore,
	GmailSenderStore,
} from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { RevokeGmailGrant } from "@packages/provider-contracts/gmail-oauth";
import type { HutchLogger } from "@packages/hutch-logger";
import type { RewriteGmailFilter } from "./rewrite-gmail-filter";

export type DisconnectGmailOutcome =
	| { ok: true; filterRemoved: boolean; grantRevoked: boolean }
	| { ok: false; reason: "not-connected" }
	| { ok: false; reason: "unavailable" };

export type DisconnectGmail = (input: { userId: UserId }) => Promise<DisconnectGmailOutcome>;

export function initDisconnectGmail(deps: {
	connections: GmailConnectionStore;
	credentials: GmailCredentialsStore;
	senders: GmailSenderStore;
	rewriteGmailFilter: RewriteGmailFilter;
	revokeGmailGrant: RevokeGmailGrant;
	logger: HutchLogger;
}): DisconnectGmail {
	const { connections, credentials, senders, rewriteGmailFilter, revokeGmailGrant, logger } = deps;

	return async ({ userId }) => {
		const connection = await connections.findConnectionByUserId(userId);
		if (connection === undefined) return { ok: false, reason: "not-connected" };

		await senders.deleteAllSendersByUserId(userId);
		const rewritten = await rewriteGmailFilter({ userId });
		if (!rewritten.ok && rewritten.reason === "unavailable") {
			return { ok: false, reason: "unavailable" };
		}
		const filterRemoved = rewritten.ok;
		if (!rewritten.ok) {
			logger.warn("[disconnect-gmail] filter left in place", {
				userId,
				reason: rewritten.reason,
			});
		}

		const refreshToken = await credentials.findRefreshTokenByUserId(userId);
		let grantRevoked = false;
		if (refreshToken !== undefined) {
			const revoked = await revokeGmailGrant({ refreshToken });
			if (!revoked.ok) return { ok: false, reason: "unavailable" };
			grantRevoked = true;
		}

		await credentials.deleteCredentials(userId);
		await connections.deleteConnection(userId);
		return { ok: true, filterRemoved, grantRevoked };
	};
}
