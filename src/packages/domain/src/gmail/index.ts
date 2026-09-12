export { aliasNameForSender } from "./alias-name-for-sender";
export { parseGmailFrom } from "./parse-gmail-from";
export { GmailAccountEmailSchema } from "./gmail-account-email.schema";
export type { GmailAccountEmail } from "./gmail-account-email.schema";
export {
	GMAIL_FILTER_QUERY_MAX_LENGTH,
	ForwardableSenderSchema,
	buildForwardingFilterQuery,
	parseForwardableSender,
} from "./build-forwarding-filter-query";
export type {
	ForwardableSender,
	ForwardingFilterQuery,
	ForwardingFilterQueryResult,
} from "./build-forwarding-filter-query";
export { gmailConnectionState } from "./gmail-connection-state";
export type { GmailConnectionState } from "./gmail-connection-state";
export { groupSendersByDestination } from "./group-senders-by-destination";
export type { GmailDestinationGroup } from "./group-senders-by-destination";
export type {
	GmailConnection,
	GmailConnectionStore,
	GmailFilterError,
	GmailFilterErrorCode,
	GmailRevokedReason,
} from "./gmail-connection.types";
export type { GmailCredentialsStore } from "./gmail-credentials.types";
export type { GmailHeldMailEntry, GmailHeldMailStore } from "./gmail-held-mail.types";
export type { GmailSenderEntry, GmailSenderStore } from "./gmail-sender.types";
export type { DiscoveredGmailSender, GmailDiscovery, GmailDiscoveryStore } from "./gmail-discovery.types";
