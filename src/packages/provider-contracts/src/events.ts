import type { UserId } from "@packages/domain/user";

export type PublishCancelSubscriptionCommand = (params: {
	userId: UserId;
}) => Promise<void>;

export type PublishExportUserDataCommand = (params: {
	userId: string;
	email: string;
	requestedAt: string;
}) => Promise<void>;

export type PublishLinkSaved = (params: {
	url: string;
	userId: string;
}) => Promise<void>;

export type PublishRecrawlLinkInitiated = (params: {
	url: string;
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
	userId: string;
	title?: string;
}) => Promise<void>;

export type PublishSaveLinkRawPdfCommand = (params: {
	url: string;
	userId: string;
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
	| "user_initiated_trial"
	| "user_initiated_paid_confirmed";

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

export type PublishSubscriptionStartRequestCommand = (params: {
	userId: UserId;
}) => Promise<void>;

export type PublishUpdateFetchTimestamp = (params: {
	url: string;
	contentFetchedAt: string;
	bodyHash?: string;
}) => Promise<void>;
