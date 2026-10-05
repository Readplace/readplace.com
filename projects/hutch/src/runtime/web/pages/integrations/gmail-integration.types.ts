import type {
	ForwardableSender,
	GmailConnectionStore,
	GmailCredentialsStore,
	GmailDiscoveryStore,
	GmailHistoryImportCancelReason,
	GmailHistoryImportJob,
	GmailHistoryImportJobId,
	GmailHistoryImportStore,
	GmailSenderStore,
} from "@packages/domain/gmail";
import type { InboxAddress, InboxAddressEntry } from "@packages/domain/inbox";
import type { DetectNewsletters } from "@packages/domain/newsletter-catalog";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ListReadlistDefinitions } from "@packages/provider-contracts/article-store";
import type { FindGmailAccountEmail } from "@packages/provider-contracts/gmail-account";
import type { GmailMonitoringStore } from "@packages/provider-contracts/gmail-monitoring";
import type { ExchangeGmailCode } from "@packages/provider-contracts/gmail-oauth";
import type { UpsertReadlist } from "@packages/save-article";

export interface GmailIntegrationProviders {
	exchangeGmailCode: ExchangeGmailCode;
	findGmailAccountEmail: FindGmailAccountEmail;
	clientId: string;
	stateSecret: string;
	gmailCredentialsStore: GmailCredentialsStore;
	gmailConnectionStore: GmailConnectionStore;
	gmailSenderStore: GmailSenderStore;
	gmailDiscoveryStore: GmailDiscoveryStore;
	gmailMonitoringStore: GmailMonitoringStore;
	publishStartGmailSenderDiscovery: (input: { userId: UserId }) => Promise<void>;
	mintGatewayAddress: (input: { userId: UserId }) => Promise<InboxAddress>;
	findInboxAddress: (address: InboxAddress) => Promise<InboxAddressEntry | undefined>;
	publishRewriteGmailFilter: (input: {
		userId: UserId;
		reason: "forwarding-confirmed" | "sender-added" | "sender-removed" | "retry-requested" | "reconnected" | "readlist-deleted";
	}) => Promise<void>;
	publishDisconnectGmail: (input: { userId: UserId }) => Promise<void>;
	getOrCreateReadlistAddress: (input: { userId: UserId; readlist: ReadlistSlug }) => Promise<InboxAddressEntry>;
	findReadlistAddress: (input: { userId: UserId; readlist: ReadlistSlug }) => Promise<InboxAddressEntry | undefined>;
	retireReadlistAddress: (input: { userId: UserId; readlist: ReadlistSlug }) => Promise<InboxAddress | undefined>;
	gmailHistoryImportStore: GmailHistoryImportStore;
	cancelGmailHistoryImports: (input: {
		userId: UserId;
		senderEmail: ForwardableSender | undefined;
		reason: GmailHistoryImportCancelReason;
	}) => Promise<GmailHistoryImportJob[]>;
	publishStartGmailHistoryImport: (input: { userId: UserId; jobId: GmailHistoryImportJobId; generation: string }) => Promise<void>;
	publishSubmitNewsletterSender: (input: { senderEmail: ForwardableSender }) => Promise<void>;
	newGmailHistoryImportJobId: () => GmailHistoryImportJobId;
	newGmailHistoryImportGeneration: () => string;
	diagnosticsLogger: HutchLogger;
}

export interface GmailIntegrationDependencies extends GmailIntegrationProviders {
	detectNewsletters: DetectNewsletters;
	upsertReadlist: UpsertReadlist;
	listReadlistDefinitions: ListReadlistDefinitions;
}
