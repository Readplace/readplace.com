import assert from "node:assert";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { z } from "zod";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ReaderArticleHashId } from "@packages/domain/article";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { ReaderReadyEmailSentEvent, SendUserDigestCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type {
	DigestCandidate,
	DigestEmailFilter,
	DigestPageCursor,
	FindUnreadSavesForDigest,
	MarkReaderReadyEmailSent,
} from "@packages/provider-contracts/article-store";
import type { FindGeneratedSummary, GeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { FindUserContactByUserId } from "@packages/provider-contracts/auth";
import { EmailRejectedError, type SendEmail } from "@packages/provider-contracts/email";
import type {
	ClaimReaderReadyEmailSlot,
	FindReaderReadyEmailState,
	ReaderReadyEmailSlotClaim,
	ReaderReadyEmailState,
	ReleaseReaderReadyEmailSlot,
} from "@packages/provider-contracts/reader-ready-state";
import type {
	ClaimPayDigest,
	FindSubscriptionByUserId,
	PayDigestClaim,
	ReleasePayDigest,
	SubscriptionRecord,
} from "@packages/provider-contracts/subscription-providers";
import { resolveEffectiveAccess } from "@packages/subscription-access";
import { STRIPE_TRIAL_PERIOD_DAYS, isPayDigestDue } from "../domain/stripe/stripe-trial-config";
import type {
	EmitQueueDigestEvent,
	QueueDigestSentKind,
	QueueDigestSkipReason,
} from "../observability/queue-digest-events";
import { buildDigestPreview } from "../web/digest-preview";
import { CONSENT_SEED_ARTICLE_URL } from "../web/oauth/consent-seed-save";
import {
	QueueDigestEmail,
	type QueueDigestEmailItem,
	type QueueDigestKind,
	type QueueDigestLinks,
} from "../web/queue-digest-email";

const EMAIL_FROM = "Readplace <readplace@readplace.com>";
const EMAIL_REPLY_TO = "fayner@readplace.com";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CONSENT_SEED_ARTICLE_KEY = ArticleResourceUniqueId.parse(CONSENT_SEED_ARTICLE_URL).value;

export interface SendQueueDigestDeps {
	enrollStarter: (userId: UserId) => Promise<void>;
	processStarter: (userId: UserId) => Promise<boolean>;
	findUserContactByUserId: FindUserContactByUserId;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	findReaderReadyEmailState: FindReaderReadyEmailState;
	findUnreadSavesForDigest: FindUnreadSavesForDigest;
	findGeneratedSummary: FindGeneratedSummary;
	claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot;
	releaseReaderReadyEmailSlot: ReleaseReaderReadyEmailSlot;
	claimPayDigest: ClaimPayDigest;
	releasePayDigest: ReleasePayDigest;
	markReaderReadyEmailSent: MarkReaderReadyEmailSent;
	sendEmail: SendEmail;
	publishEvent: PublishEvent;
	emitQueueDigestEvent: EmitQueueDigestEvent;
	signUnsubscribeToken: (userId: UserId) => string;
	signMarkReadToken: (input: { userId: UserId; articleIds: ReaderArticleHashId[] }) => string;
	appOrigin: string;
	cooldownMs: number;
	regularDigestMinGapMs: number;
	minSaveAgeMs: number;
	maxDigestItems: number;
	maxCandidatesRead: number;
	now: () => Date;
	logger: HutchLogger;
}

interface ReadyItem {
	candidate: DigestCandidate;
	summary: GeneratedSummary;
}

interface DigestQuery {
	savedAtOrBefore: Date;
	emailFilter: DigestEmailFilter;
}

type DigestClaim = ReaderReadyEmailSlotClaim | PayDigestClaim;

interface DigestKindPlan {
	kind: QueueDigestKind;
	emptyReason: Extract<QueueDigestSkipReason, "no-eligible-items" | "pay-no-ready-saves">;
	notClaimedWarning: string;
	sentKind: QueueDigestSentKind;
	query: DigestQuery;
	held: boolean;
	claim: (urls: readonly string[]) => Promise<DigestClaim>;
	release: () => Promise<void>;
	email: (input: { items: QueueDigestEmailItem[]; links: QueueDigestLinks }) => ReturnType<typeof QueueDigestEmail>;
}

interface RecipientContext {
	userId: UserId;
	messageId: string;
	row: SubscriptionRecord;
	readerReadyState: ReaderReadyEmailState;
	sendInstant: Date;
	deps: SendQueueDigestDeps;
}

const REGULAR_DIGEST_NOT_CLAIMED_WARNING = "[SendQueueDigest] rate-limited";

export function initSendQueueDigestHandler(deps: SendQueueDigestDeps): Handler<SQSEvent, SQSBatchResponse> {
	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = SendUserDigestCommand.detailSchema.parse(envelope.detail);
				await processQueueDigest({ userId: UserIdSchema.parse(detail.userId), messageId: record.messageId, deps });
			} catch (error) {
				deps.logger.error("[SendQueueDigest] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}

async function processQueueDigest(params: {
	userId: UserId;
	messageId: string;
	deps: SendQueueDigestDeps;
}): Promise<void> {
	const { userId, messageId, deps } = params;
	const sendInstant = deps.now();
	const [contact, row, readerReadyState] = await Promise.all([
		deps.findUserContactByUserId(userId),
		deps.findSubscriptionByUserId(userId),
		deps.findReaderReadyEmailState(userId),
	]);
	if (await finishedOwnRedrive({ userId, messageId, row, readerReadyState, sendInstant, deps })) return;
	try {
		await deps.enrollStarter(userId);
	} catch (error) {
		deps.logger.error("[SendQueueDigest] starter enrollment failed", { userId, error });
	}

	const access = resolveEffectiveAccess(row, sendInstant);
	const skip = (reason: string) => deps.logger.info("[SendQueueDigest] skipped", { userId, reason });
	const skipAndRecord = (reason: QueueDigestSkipReason) => {
		deps.emitQueueDigestEvent.skipped({ userId, tier: access.tier, reason });
		skip(reason);
	};

	const payDue = row !== undefined && isPayDigestDue({ row, messageId, now: sendInstant });
	if (!payDue && await deps.processStarter(userId)) return;
	if (!contact?.emailVerified) return skipAndRecord("no-verified-email");
	if (contact.queueDigestOptOutAt !== undefined) return skipAndRecord("unsubscribed");
	if (access.tier !== "trial" && access.tier !== "paid") return skip("not-eligible-tier");
	assert(row, "a trial or paid tier is always resolved from a subscription row");
	const tier = access.tier;

	const context: RecipientContext = { userId, messageId, row, readerReadyState, sendInstant, deps };
	const plan = payDue
		? payDigestPlan(context)
		: regularDigestPlan(context);
	if (plan.held) return skip("cadence");

	const items = await selectReadyItems({ deps, userId, query: plan.query });
	if (items.length === 0) return skipAndRecord(plan.emptyReason);

	const claim = await plan.claim(items.map((item) => item.candidate.article.url));
	if (
		await settleHeldClaim({
			claim,
			kind: plan.kind,
			notClaimedWarning: plan.notClaimedWarning,
			userId,
			messageId,
			deps,
		})
	) {
		return;
	}

	const email = plan.email({
		items: items.map(toEmailItem),
		links: { appOrigin: deps.appOrigin, sendId: messageId, unsubscribeToken: deps.signUnsubscribeToken(userId) },
	});
	try {
		await deps.sendEmail({
			from: EMAIL_FROM,
			to: contact.email,
			replyTo: EMAIL_REPLY_TO,
			subject: email.subject,
			html: email.to("text/html"),
			text: email.to("text/plain"),
			headers: email.headers,
		});
	} catch (error) {
		if (error instanceof EmailRejectedError) await plan.release();
		throw error;
	}

	deps.emitQueueDigestEvent.sent({
		userId,
		sendId: messageId,
		...plan.sentKind,
		itemCount: items.length,
		previouslyEmailedCount: items.filter((item) => item.candidate.emailSentAt !== undefined).length,
		tier,
		trialDay: trialDayOf({ row, tier, sendInstant }),
	});
	await finishDigest({
		urls: items.map((item) => item.candidate.article.url),
		userId,
		sentAt: sendInstant,
		kind: plan.kind,
		redelivery: false,
		deps,
	});
}

async function finishedOwnRedrive(params: {
	userId: UserId;
	messageId: string;
	row: SubscriptionRecord | undefined;
	readerReadyState: ReaderReadyEmailState;
	sendInstant: Date;
	deps: SendQueueDigestDeps;
}): Promise<boolean> {
	const { userId, messageId, row, readerReadyState, sendInstant, deps } = params;
	if (readerReadyState.lastMessageId === messageId) {
		const claim = await claimRegularDigest({ userId, messageId, sendInstant, deps, urls: [] });
		const settled = await settleHeldClaim({
			claim,
			kind: "regular",
			notClaimedWarning: REGULAR_DIGEST_NOT_CLAIMED_WARNING,
			userId,
			messageId,
			deps,
		});
		assert(settled, "an own redrive arrives inside its claim's cooldown, so its claim reports the redelivery");
		return true;
	}
	if (row?.payDigestMessageId !== messageId) return false;
	assert(row.payDigestEmailSentAt, "a stored pay-digest claim carries its instant");
	assert(row.payDigestUrls, "a stored pay-digest claim carries the urls it listed");
	await finishDigest({
		urls: row.payDigestUrls,
		userId,
		sentAt: new Date(row.payDigestEmailSentAt),
		kind: "pay",
		redelivery: true,
		deps,
	});
	return true;
}

function regularDigestPlan(context: RecipientContext): DigestKindPlan {
	const { userId, messageId, row, readerReadyState, sendInstant, deps } = context;
	const lastDigestMs = Math.max(
		readerReadyState.lastSentAt?.getTime() ?? Number.NEGATIVE_INFINITY,
		row.payDigestEmailSentAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(row.payDigestEmailSentAt),
	);
	return {
		kind: "regular",
		emptyReason: "no-eligible-items",
		notClaimedWarning: REGULAR_DIGEST_NOT_CLAIMED_WARNING,
		sentKind: { kind: "regular" },
		query: {
			savedAtOrBefore: new Date(sendInstant.getTime() - deps.minSaveAgeMs),
			emailFilter: { kind: "not-emailed-before", sendInstant },
		},
		held: sendInstant.getTime() - lastDigestMs < deps.regularDigestMinGapMs,
		claim: (urls) => claimRegularDigest({ userId, messageId, sendInstant, deps, urls }),
		release: () => deps.releaseReaderReadyEmailSlot({ userId, claimedAt: sendInstant, messageId }),
		email: ({ items, links }) =>
			QueueDigestEmail({
				kind: "regular",
				items,
				links,
				markReadToken: deps.signMarkReadToken({ userId, articleIds: items.map((item) => item.articleId) }),
			}),
	};
}

function payDigestPlan(context: RecipientContext): DigestKindPlan {
	const { userId, messageId, row, sendInstant, deps } = context;
	const { trialEndsAt } = row;
	assert(trialEndsAt, "a pay digest is only due on a trialing row, which always carries trialEndsAt");
	return {
		kind: "pay",
		emptyReason: "pay-no-ready-saves",
		notClaimedWarning: "[SendQueueDigest] pay-already-claimed",
		sentKind: { kind: "pay", hoursToTrialEnd: Math.floor((Date.parse(trialEndsAt) - sendInstant.getTime()) / HOUR_MS) },
		query: { savedAtOrBefore: sendInstant, emailFilter: { kind: "any" } },
		held: false,
		claim: (urls) => deps.claimPayDigest({ userId, trialEndsAt, messageId, now: sendInstant, urls }),
		release: () => deps.releasePayDigest({ userId, claimedAt: sendInstant, messageId }),
		email: ({ items, links }) => QueueDigestEmail({ kind: "pay", items, links, pay: { trialEndsAt } }),
	};
}

function claimRegularDigest(params: {
	userId: UserId;
	messageId: string;
	sendInstant: Date;
	deps: SendQueueDigestDeps;
	urls: readonly string[];
}): Promise<ReaderReadyEmailSlotClaim> {
	const { userId, messageId, sendInstant, deps, urls } = params;
	return deps.claimReaderReadyEmailSlot({ userId, now: sendInstant, cooldownMs: deps.cooldownMs, messageId, urls });
}

async function settleHeldClaim(params: {
	claim: DigestClaim;
	kind: QueueDigestKind;
	notClaimedWarning: string;
	userId: UserId;
	messageId: string;
	deps: SendQueueDigestDeps;
}): Promise<boolean> {
	const { claim, kind, notClaimedWarning, userId, messageId, deps } = params;
	if (!claim.claimed) {
		deps.logger.warn(notClaimedWarning, { userId, messageId });
		return true;
	}
	if (!claim.redelivery) return false;
	await finishDigest({ urls: claim.urls, userId, sentAt: claim.claimedAt, kind, redelivery: true, deps });
	return true;
}

async function selectReadyItems(params: {
	deps: SendQueueDigestDeps;
	userId: UserId;
	query: DigestQuery;
}): Promise<ReadyItem[]> {
	const { deps, userId, query } = params;
	const ready: ReadyItem[] = [];
	let candidatesRequested = 0;
	let cursor: DigestPageCursor | undefined;
	do {
		const limit = Math.min(deps.maxDigestItems + 1, deps.maxCandidatesRead - candidatesRequested);
		const page = await deps.findUnreadSavesForDigest({ userId, ...query, limit, cursor });
		candidatesRequested += limit;
		const pageReady = await readyItemsOf({ candidates: page.candidates, deps });
		ready.push(...pageReady.slice(0, deps.maxDigestItems - ready.length));
		cursor = page.nextCursor;
	} while (cursor !== undefined && ready.length < deps.maxDigestItems && candidatesRequested < deps.maxCandidatesRead);
	return ready;
}

async function readyItemsOf(params: {
	candidates: DigestCandidate[];
	deps: SendQueueDigestDeps;
}): Promise<ReadyItem[]> {
	const loaded = params.candidates.filter(
		(candidate) =>
			ArticleResourceUniqueId.parse(candidate.article.url).value !== CONSENT_SEED_ARTICLE_KEY &&
			candidate.article.provenance?.kind !== "hn-suggestion" &&
			candidate.article.provenance?.kind !== "founder-seed" &&
			candidate.readerAvailableAt !== undefined &&
			candidate.purgedAt === undefined,
	);
	const withSummaries = await Promise.all(
		loaded.map(async (candidate) => ({
			candidate,
			summary: await params.deps.findGeneratedSummary(candidate.article.url),
		})),
	);
	return withSummaries.flatMap(({ candidate, summary }) =>
		summary?.status === "ready" ? [{ candidate, summary }] : [],
	);
}

function toEmailItem({ candidate, summary }: ReadyItem): QueueDigestEmailItem {
	return {
		articleId: candidate.article.id,
		title: candidate.article.metadata.title,
		siteName: candidate.article.metadata.siteName,
		preview: buildDigestPreview(summary),
	};
}

function trialDayOf(input: { row: SubscriptionRecord; tier: "trial" | "paid"; sendInstant: Date }): number | null {
	if (input.tier === "paid") return null;
	assert(input.row.trialEndsAt, "a trial tier is always resolved from a row carrying trialEndsAt");
	const msToTrialEnd = Date.parse(input.row.trialEndsAt) - input.sendInstant.getTime();
	const trialDay = STRIPE_TRIAL_PERIOD_DAYS + 1 - Math.ceil(msToTrialEnd / DAY_MS);
	return trialDay >= 1 ? trialDay : null;
}

async function finishDigest(params: {
	urls: readonly string[];
	userId: UserId;
	sentAt: Date;
	kind: QueueDigestKind;
	redelivery: boolean;
	deps: SendQueueDigestDeps;
}): Promise<void> {
	const { urls, userId, sentAt, kind, redelivery, deps } = params;
	await Promise.all(
		urls.map(async (url) => {
			try {
				await deps.markReaderReadyEmailSent({ userId, url, at: sentAt });
			} catch (error) {
				deps.logger.error("[SendQueueDigest] mark-email-sent failed", { userId, url, error });
			}
		}),
	);
	try {
		await deps.publishEvent(ReaderReadyEmailSentEvent, { userId, urls: [...urls], sentAt: sentAt.toISOString() });
	} catch (error) {
		deps.logger.error("[SendQueueDigest] event publish failed", { userId, error });
	}
	deps.logger.info("[SendQueueDigest] sent digest", { userId, kind, itemCount: urls.length, redelivery });
}
