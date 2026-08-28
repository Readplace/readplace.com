import type { ForwardableSender } from "@packages/domain/gmail";
import { aliasNameForSender } from "@packages/domain/gmail";
import { GMAIL_FORWARDING_ALIAS } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { GmailIntegrationBundle } from "@packages/web-test-harness";
import type { GmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { initInMemoryInboxAddress } from "../inbox-address";
import { initInMemoryGmailConnection } from "../gmail-connection";
import { initInMemoryGmailCredentials } from "../gmail-credentials";
import { initInMemoryGmailSender } from "../gmail-sender";

export interface InMemoryGmailIntegration {
	bundle: GmailIntegrationBundle;
	exchangedCodes: string[];
	rewriteRequests: { userId: UserId; reason: string }[];
	disconnectRequests: { userId: UserId }[];
}

export function initInMemoryGmailIntegration(input: {
	grant: GmailGrantResult;
	domain?: string;
	now?: () => Date;
}): InMemoryGmailIntegration {
	const now = input.now ?? (() => new Date());
	const domain = input.domain ?? "read.place";
	const addresses = initInMemoryInboxAddress({ now });
	const exchangedCodes: string[] = [];
	const rewriteRequests: { userId: UserId; reason: string }[] = [];
	const disconnectRequests: { userId: UserId }[] = [];

	return {
		exchangedCodes,
		rewriteRequests,
		disconnectRequests,
		bundle: {
			exchangeGmailCode: async ({ code }) => {
				exchangedCodes.push(code);
				return input.grant;
			},
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
			mintSenderAddress: async ({
				userId,
				senderEmail,
			}: { userId: UserId; senderEmail: ForwardableSender }) => {
				const entry = await addresses.createAddress({
					userId,
					domain,
					name: aliasNameForSender(senderEmail),
					purpose: "gmail-mapped",
				});
				return entry.address;
			},
			publishRewriteGmailFilter: async (detail) => {
				rewriteRequests.push(detail);
			},
			publishDisconnectGmail: async (detail) => {
				disconnectRequests.push(detail);
			},
		},
	};
}
