import type { ForwardableSender, GmailAccountEmail, GmailHistoryImportJobId } from "@packages/domain/gmail";
import { GmailHistoryImportJobIdSchema } from "@packages/domain/gmail";
import { GMAIL_FORWARDING_ALIAS } from "@packages/domain/inbox";
import type { InboxAddressStore } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { GmailIntegrationBundle } from "@packages/web-test-harness";
import type { GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import type { GmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { initInMemoryGmailConnection } from "../gmail-connection";
import { initInMemoryGmailCredentials } from "../gmail-credentials";
import { initInMemoryGmailSender } from "../gmail-sender";
import { initInMemoryGmailDiscovery } from "../gmail-discovery";
import { initInMemoryGmailHistoryImport } from "../gmail-history-import";

export interface InMemoryGmailIntegration {
	bundle: GmailIntegrationBundle;
	addresses: InboxAddressStore;
	exchangedCodes: string[];
	rewriteRequests: { userId: UserId; reason: string }[];
	disconnectRequests: { userId: UserId }[];
	discoveryRequests: { userId: UserId }[];
	importStartRequests: { userId: UserId; jobId: GmailHistoryImportJobId; generation: string }[];
	newsletterSenderSubmissions: { senderEmail: ForwardableSender }[];
}

export function initInMemoryGmailIntegration(input: {
	grant: GmailGrantResult;
	addresses: InboxAddressStore;
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
	const addresses = input.addresses;
	const imports = initInMemoryGmailHistoryImport();
	const importStartRequests: { userId: UserId; jobId: GmailHistoryImportJobId; generation: string }[] = [];
	const newsletterSenderSubmissions: { senderEmail: ForwardableSender }[] = [];
	let jobSequence = 0;
	let generationSequence = 0;
	const exchangedCodes: string[] = [];
	const rewriteRequests: { userId: UserId; reason: string }[] = [];
	const disconnectRequests: { userId: UserId }[] = [];
	const discoveryRequests: { userId: UserId }[] = [];

	return {
		addresses,
		exchangedCodes,
		rewriteRequests,
		disconnectRequests,
		discoveryRequests,
		importStartRequests,
		newsletterSenderSubmissions,
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
			gmailDiscoveryStore: initInMemoryGmailDiscovery({ now }),
			publishStartGmailSenderDiscovery: async (detail) => {
				discoveryRequests.push(detail);
			},
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
			publishRewriteGmailFilter: async (detail) => {
				rewriteRequests.push(detail);
			},
			publishDisconnectGmail: async (detail) => {
				disconnectRequests.push(detail);
			},
			getOrCreateReadlistAddress: ({ userId, readlist }) =>
				addresses.getOrCreateReadlistAddress({ userId, domain, readlist }),
			findReadlistAddress: addresses.findReadlistAddress,
			retireReadlistAddress: addresses.retireReadlistAddress,
			gmailHistoryImportStore: imports,
			cancelGmailHistoryImports: (detail) => imports.cancelJobs({ ...detail, now: now() }),
			publishStartGmailHistoryImport: async (detail) => {
				importStartRequests.push(detail);
			},
			publishSubmitNewsletterSender: async (detail) => {
				newsletterSenderSubmissions.push(detail);
			},
			newGmailHistoryImportJobId: () => {
				jobSequence += 1;
				return GmailHistoryImportJobIdSchema.parse(jobSequence.toString(16).padStart(32, "0"));
			},
			newGmailHistoryImportGeneration: () => {
				generationSequence += 1;
				return `generation-${generationSequence}`;
			},
		},
	};
}
