import type { GmailAccountEmail } from "@packages/domain/gmail";
import { GMAIL_FORWARDING_ALIAS } from "@packages/domain/inbox";
import type { AliasName, InboxAddressStore } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { GmailIntegrationBundle } from "@packages/web-test-harness";
import type { GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import type { GmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { initInMemoryInboxAddress } from "../inbox-address";
import { initInMemoryGmailConnection } from "../gmail-connection";
import { initInMemoryGmailCredentials } from "../gmail-credentials";
import { initInMemoryGmailSender } from "../gmail-sender";

export interface InMemoryGmailIntegration {
	bundle: GmailIntegrationBundle;
	addresses: InboxAddressStore;
	exchangedCodes: string[];
	rewriteRequests: { userId: UserId; reason: string }[];
	disconnectRequests: { userId: UserId }[];
}

export function initInMemoryGmailIntegration(input: {
	grant: GmailGrantResult;
	accountEmail?: GmailApiResult<GmailAccountEmail>;
	domain?: string;
	now?: () => Date;
}): InMemoryGmailIntegration {
	const accountEmail: GmailApiResult<GmailAccountEmail> = input.accountEmail ?? {
		ok: false,
		reason: "reauth-required",
	};
	const now = input.now ?? (() => new Date());
	const domain = input.domain ?? "read.place";
	const addresses = initInMemoryInboxAddress({ now });
	const exchangedCodes: string[] = [];
	const rewriteRequests: { userId: UserId; reason: string }[] = [];
	const disconnectRequests: { userId: UserId }[] = [];

	return {
		addresses,
		exchangedCodes,
		rewriteRequests,
		disconnectRequests,
		bundle: {
			exchangeGmailCode: async ({ code }) => {
				exchangedCodes.push(code);
				return input.grant;
			},
			findGmailAccountEmail: async () => accountEmail,
			clientId: "test-client-id",
			stateSecret: "test-state-secret",
			gmailCredentialsStore: initInMemoryGmailCredentials({ now }),
			gmailConnectionStore: initInMemoryGmailConnection({ now }),
			gmailSenderStore: initInMemoryGmailSender({ now }),
			mintGatewayAddress: async ({ userId }: { userId: UserId }) => {
				const entry = await addresses.createAddress({
					userId,
					domain,
					name: GMAIL_FORWARDING_ALIAS,
					purpose: "gmail-forwarding",
				});
				return entry.address;
			},
			findInboxAddress: addresses.findByAddress,
			mintInboxAddress: async ({ userId, name }: { userId: UserId; name: AliasName }) => {
				const entry = await addresses.createAddress({
					userId,
					domain,
					name,
					purpose: "gmail-mapped",
				});
				return entry.address;
			},
			listInboxAddresses: (userId: UserId) => addresses.listAddressesByUserId(userId),
			publishRewriteGmailFilter: async (detail) => {
				rewriteRequests.push(detail);
			},
			publishDisconnectGmail: async (detail) => {
				disconnectRequests.push(detail);
			},
		},
	};
}
