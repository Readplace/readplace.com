import type { UserId } from "@packages/domain/user";

export type CancelSubscriptionReason =
	| "trial_expired_no_card"
	| "trial_expired_charge_failed";

export type PublishCancelSubscriptionCommand = (params: {
	userId: UserId;
	reason?: CancelSubscriptionReason;
}) => Promise<void>;

export type PublishExportUserDataCommand = (params: {
	userId: UserId;
	email: string;
	requestedAt: string;
}) => Promise<void>;

export type PublishDeleteAccountCommand = (params: {
	userId: UserId;
}) => Promise<void>;

export type PublishLinkSaved = (params: {
	url: string;
	userId: UserId;
}) => Promise<void>;

/** Announce that a save reached its terminal accept state. `url` is the URL as
 * submitted, before canonical-alias resolution, so a consumer that keyed a
 * lookup on the URL it submitted can match it back. */
export type PublishLinkQueued = (params: {
	url: string;
	userId: UserId;
}) => Promise<void>;

/** Announce that a reader's queue row was deleted. `url` is that row's own key —
 * the canonical URL after alias resolution — so it names the article that left
 * the queue rather than any one URL a save arrived under. */
export type PublishLinkDequeued = (params: {
	url: string;
	userId: UserId;
}) => Promise<void>;

export type PublishQueueEntryCreated = (params: {
	url: string;
	userId: UserId;
}) => Promise<void>;

export type PublishRecrawlLinkInitiated = (params: {
	url: string;
}) => Promise<void>;

export type PublishRemoveMyContent = (params: {
	url: string;
	userId: UserId;
	versionMinuteId: string;
}) => Promise<void>;

export type PublishRefreshArticleContent = (params: {
	url: string;
	html: string;
	metadata: {
		title: string;
		siteName: string;
		excerpt: string;
		wordCount: number;
		imageUrl?: string;
	};
	estimatedReadTime: number;
	etag?: string;
	lastModified?: string;
	contentFetchedAt: string;
	bodyHash: string;
}) => Promise<void>;

export type PublishSaveAnonymousLink = (params: {
	url: string;
}) => Promise<void>;

export type PublishSaveLinkRawHtmlCommand = (params: {
	url: string;
	userId: UserId;
	title?: string;
}) => Promise<void>;

export type PublishSaveLinkRawPdfCommand = (params: {
	url: string;
	userId: UserId;
	title?: string;
}) => Promise<void>;

export type PublishStaleCheckRequested = (params: {
	url: string;
}) => Promise<void>;

export type PublishSubscriptionCancellationScheduled = (params: {
	userId: UserId;
	subscriptionId?: string;
	cancellationEffectiveAt: string;
}) => Promise<void>;

export type SubscriptionCancelledReason =
	| "stripe_webhook"
	| "stripe_payment_failure"
	| "user_initiated_trial"
	| "user_initiated_paid_confirmed"
	| CancelSubscriptionReason;

export type PublishSubscriptionCancelled = (params: {
	userId: UserId;
	subscriptionId?: string;
	reason: SubscriptionCancelledReason;
}) => Promise<void>;

export type SubscriptionChargeFailedReason = "no_card_on_file" | "stripe_error";

export type PublishSubscriptionChargeFailed = (params: {
	userId: UserId;
	reason: SubscriptionChargeFailedReason;
}) => Promise<void>;

export type PublishSubscriptionChargeSucceeded = (params: {
	userId: UserId;
	subscriptionId: string;
	customerId: string;
}) => Promise<void>;

export type PublishSubscriptionReactivated = (params: {
	userId: UserId;
	subscriptionId?: string;
}) => Promise<void>;

export type PublishUpdateFetchTimestamp = (params: {
	url: string;
	contentFetchedAt: string;
	bodyHash?: string;
}) => Promise<void>;
