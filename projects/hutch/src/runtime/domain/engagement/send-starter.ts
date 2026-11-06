import assert from "node:assert";
import { createHash } from "node:crypto";
import type { UserId } from "@packages/domain/user";
import type {
	EngagementStarterState,
	FrozenStarterMessage,
	StarterPack,
} from "@packages/provider-contracts/engagement-starter";
import type { FindUserContactByUserId } from "@packages/provider-contracts/auth";
import type {
	FindSubscriptionByUserId,
	SubscriptionRecord,
} from "@packages/provider-contracts/subscription-providers";
import type {
	FindReadlistArticleById,
	FindArticleById,
	FindArticleByUrl,
	GlobalArticleData,
	ListUserSavesForUrl,
	ReadArticleContent,
} from "@packages/provider-contracts/article-store";
import { type ArticleBody, ReaderArticleHashId, type Viewer, viewerFor } from "@packages/domain/article";
import type { FindGeneratedSummary, GeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { FindReaderReadyEmailState } from "@packages/provider-contracts/reader-ready-state";
import type { EmailAttachment, SendEmail } from "@packages/provider-contracts/email";
import { resolveEffectiveAccess } from "@packages/subscription-access";
import type {
	BuildQueueDigestBook,
	PreviewSummary,
	QueueDigestEmailItem,
	RenderStarterEmail,
} from "./digest-email.types";
import type { BookChapter } from "../readlist/book-chapter.types";
import {
	PAY_DIGEST_WINDOW_CLOSES_LEAD_MS,
	PAY_DIGEST_WINDOW_OPENS_LEAD_MS,
} from "../stripe/stripe-trial-config";
import { STARTER_EMAIL_GAP_MS, STARTER_RETRY_WINDOW_MS } from "./starter-policy";
import { reservedDomainOf } from "../email/reserved-domain";

function toChapter(input: {
	article: GlobalArticleData;
	summary: GeneratedSummary | undefined;
	contentHtml: ArticleBody;
}): BookChapter {
	return {
		articleUrl: input.article.url,
		title: input.article.metadata.title,
		siteName: input.article.metadata.siteName,
		excerpt: input.article.metadata.excerpt,
		summary: input.summary,
		contentHtml: input.contentHtml,
	};
}

function holdsForPayment(input: { row: SubscriptionRecord | undefined; now: Date }): boolean {
	const { row, now } = input;
	if (row?.status !== "trialing" || row.payDigestEmailSentAt !== undefined) return false;
	assert(row.trialEndsAt, "trialing subscriptions have a trial end");
	const trialEnd = Date.parse(row.trialEndsAt);
	return (
		now.getTime() < trialEnd - PAY_DIGEST_WINDOW_CLOSES_LEAD_MS &&
		now.getTime() + STARTER_EMAIL_GAP_MS >= trialEnd - PAY_DIGEST_WINDOW_OPENS_LEAD_MS
	);
}

export function initSendStarter(deps: {
	state: EngagementStarterState;
	findUserContactByUserId: FindUserContactByUserId;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	findReaderReadyEmailState: FindReaderReadyEmailState;
	findReadlistArticleById: FindReadlistArticleById;
	findArticleById: FindArticleById;
	listUserSavesForUrl: ListUserSavesForUrl;
	findArticleByUrl: FindArticleByUrl;
	findGeneratedSummary: FindGeneratedSummary;
	readArticleContent: ReadArticleContent;
	buildQueueDigestBook: BuildQueueDigestBook;
	renderStarterEmail: RenderStarterEmail;
	previewSummary: PreviewSummary;
	sendEmail: SendEmail;
	signUnsubscribeToken: (userId: UserId) => string;
	appOrigin: string;
	now: () => Date;
	emit: (input: {
		userId: UserId;
		campaignId: string;
		event: "sent" | "suppressed" | "failure";
		reason?: string;
		itemCount?: number;
	}) => void;
}): (userId: UserId) => Promise<boolean> {
	const chaptersFor = (urls: readonly string[], viewer: Viewer): Promise<BookChapter[]> =>
		Promise.all(
			urls.map(async (url) => {
				const [article, summary, stored] = await Promise.all([
					deps.findArticleByUrl(url),
					deps.findGeneratedSummary({ url, viewer }),
					deps.readArticleContent({ url, viewer }),
				]);
				assert(article, `a claimed starter pick is a stored article: ${url}`);
				assert(stored.kind === "article", `a claimed starter pick had a readable body: ${url}`);
				return toChapter({ article, summary, contentHtml: stored.body });
			}),
		);
	const bookFor = async (input: { pack: StarterPack; message: FrozenStarterMessage; userId: UserId }) => {
		const { articleUrls, firstAttemptAt } = input.pack;
		assert(articleUrls, "a claimed starter pack records the articles it lists");
		assert(firstAttemptAt, "a claimed starter pack records its first attempt");
		return deps.buildQueueDigestBook({
			subject: input.message.subject,
			sendId: input.message.idempotencyKey,
			sentAt: new Date(firstAttemptAt),
			chapters: await chaptersFor(articleUrls, viewerFor(input.userId)),
		});
	};
	return async (userId) => {
		const pack = await deps.state.findStarterPack(userId);
		if (
			pack?.insertedAt === undefined ||
			pack.emailStatus === "sent" ||
			pack.emailStatus === "suppressed" ||
			pack.emailStatus === "review"
		) {
			return false;
		}
		const now = deps.now();
		let message = pack.message;
		let itemCount = pack.itemCount;
		let book: EmailAttachment | undefined;
		if (
			pack.firstAttemptAt !== undefined &&
			now.getTime() - Date.parse(pack.firstAttemptAt) >= STARTER_RETRY_WINDOW_MS
		) {
			if (await deps.state.markStarterEmailReview({ userId, reason: "provider-window-expired" })) {
				deps.emit({
					userId,
					campaignId: pack.campaignId,
					event: "failure",
					reason: "provider-window-expired",
				});
			}
			return true;
		}
		if (message === undefined) {
			const [contact, row, slot] = await Promise.all([
				deps.findUserContactByUserId(userId),
				deps.findSubscriptionByUserId(userId),
				deps.findReaderReadyEmailState(userId),
			]);
			const access = resolveEffectiveAccess(row, now);
			if (
				!contact?.emailVerified ||
				contact.queueDigestOptOutAt !== undefined ||
				contact.deletedAt !== undefined ||
				reservedDomainOf(contact.email) !== undefined ||
				(access.tier !== "trial" && access.tier !== "paid")
			) {
				if (await deps.state.suppressStarterEmail({ userId, reason: "recipient-ineligible" })) {
					deps.emit({
						userId,
						campaignId: pack.campaignId,
						event: "suppressed",
						reason: "recipient-ineligible",
					});
				}
				return true;
			}
			const latestDigest = Math.max(
				slot.lastSentAt?.getTime() ?? Number.NEGATIVE_INFINITY,
				row?.payDigestEmailSentAt === undefined
					? Number.NEGATIVE_INFINITY
					: Date.parse(row.payDigestEmailSentAt),
			);
			if (now.getTime() - latestDigest < STARTER_EMAIL_GAP_MS || holdsForPayment({ row, now })) {
				return true;
			}
			const items: QueueDigestEmailItem[] = [];
			const chapters: BookChapter[] = [];
			for (const pick of pack.picks) {
				const [article, summary, memberships, stored] = await Promise.all([
					deps.findArticleByUrl(pick.url),
					deps.findGeneratedSummary({ url: pick.url, viewer: viewerFor(userId) }),
					deps.listUserSavesForUrl({ userId, url: pick.url }),
					deps.readArticleContent({ url: pick.url, viewer: viewerFor(userId) }),
				]);
				if (
					article?.purgedAt !== undefined ||
					article?.readerAvailableAt === undefined ||
					summary?.status !== "ready" ||
					stored.kind !== "article"
				) {
					continue;
				}
				let unreadSuggestion = false;
				for (const membership of memberships) {
					const saved =
						membership.readlist === undefined
							? await deps.findArticleById(ReaderArticleHashId.from(pick.url), userId)
							: await deps.findReadlistArticleById({
									userId,
									id: ReaderArticleHashId.from(pick.url),
									readlist: membership.readlist,
								});
					if (
						saved?.status === "unread" &&
						saved.provenance?.kind === "hn-suggestion" &&
						saved.provenance.campaignId === pack.campaignId
					) {
						unreadSuggestion = true;
					}
				}
				if (unreadSuggestion) {
					items.push({
						articleId: article.id,
						title: article.metadata.title,
						siteName: article.metadata.siteName,
						preview: deps.previewSummary(summary),
					});
					chapters.push(toChapter({ article, summary, contentHtml: stored.body }));
				}
			}
			if (items.length === 0) {
				if (await deps.state.suppressStarterEmail({ userId, reason: "no-unread-picks" })) {
					deps.emit({
						userId,
						campaignId: pack.campaignId,
						event: "suppressed",
						reason: "no-unread-picks",
					});
				}
				return true;
			}
			const sendDigest = createHash("sha256")
				.update(JSON.stringify([userId, pack.campaignId]))
				.digest("hex");
			const idempotencyKey = `starter/${sendDigest}`;
			const email = deps.renderStarterEmail({
				starter: { readlist: pack.readlist, campaignId: pack.campaignId },
				items,
				links: {
					appOrigin: deps.appOrigin,
					sendId: `starter-${sendDigest}`,
					unsubscribeToken: deps.signUnsubscribeToken(userId),
				},
			});
			const frozen: FrozenStarterMessage = {
				from: "Readplace <readplace@readplace.com>",
				replyTo: "fayner@readplace.com",
				to: contact.email,
				subject: email.subject,
				html: email.to("text/html"),
				text: email.to("text/plain"),
				headers: email.headers,
				idempotencyKey,
			};
			const freshBook = await deps.buildQueueDigestBook({
				subject: email.subject,
				sendId: idempotencyKey,
				sentAt: now,
				chapters,
			});
			const claim = await deps.state.claimStarterEmail({
				userId,
				message: frozen,
				at: now,
				minGapMs: STARTER_EMAIL_GAP_MS,
				itemCount: items.length,
				articleUrls: chapters.map((chapter) => chapter.articleUrl),
			});
			if (claim === undefined) return true;
			message = claim.message;
			itemCount = claim.itemCount;
			assert(message, "a claimed starter pack carries its frozen message");
			book = claim.message === frozen ? freshBook : await bookFor({ pack: claim, message, userId });
		}
		assert(message, "a starter attempt uses the complete frozen message");
		const attachment = book ?? (await bookFor({ pack, message, userId }));
		try {
			await deps.sendEmail({ ...message, attachments: [attachment] });
		} catch (error) {
			deps.emit({
				userId,
				campaignId: pack.campaignId,
				event: "failure",
				reason: "email-attempt-failed",
			});
			throw error;
		}
		deps.emit({ userId, campaignId: pack.campaignId, event: "sent", itemCount });
		try {
			await deps.state.markStarterEmailSent({ userId, at: now });
		} catch (error) {
			deps.emit({
				userId,
				campaignId: pack.campaignId,
				event: "failure",
				reason: "accepted-email-bookkeeping-failed",
			});
			throw error;
		}
		return true;
	};
}
