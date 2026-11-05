import { hasGmailScope } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import { GMAIL_METADATA_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";

type StartGmailDiscoveryOutcome =
	| { ok: true; discoveryAfter: string }
	| { ok: false; error: "metadata-required" };

export type StartGmailDiscovery = (userId: UserId) => Promise<StartGmailDiscoveryOutcome>;

export function initStartGmailDiscovery(deps: { gmail: GmailIntegrationDependencies }): StartGmailDiscovery {
	const { gmail } = deps;
	return async (userId) => {
		const scope = await gmail.gmailCredentialsStore.findGrantedScopeByUserId(userId);
		if (!hasGmailScope({ grantedScope: scope, scope: GMAIL_METADATA_SCOPE })) return { ok: false, error: "metadata-required" };
		const previous = await gmail.gmailDiscoveryStore.findDiscoveryByUserId(userId);
		await gmail.publishStartGmailSenderDiscovery({ userId });
		return { ok: true, discoveryAfter: previous?.updatedAt ?? "none" };
	};
}
