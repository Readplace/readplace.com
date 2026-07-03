import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import { DigestEmailSentEvent, SendUserDigestCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { UserIdSchema } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import type {
	FindArticleByUrl,
	FindUserArticleNotificationState,
	MarkReaderReadyEmailSent,
	ReadArticleContent,
	UserArticleNotificationState,
} from "@packages/provider-contracts/article-store";
import type { FindUserContactByUserId } from "@packages/provider-contracts/auth";
import type {
	ClaimReaderReadyEmailSlot,
	ReleaseReaderReadyEmailSlot,
} from "@packages/provider-contracts/reader-ready-state";
import type {
	DeleteDigestItem,
	DigestQueueItem,
	ListDigestItemsByUser,
} from "@packages/provider-contracts/digest-queue";
import type { SendEmail } from "@packages/provider-contracts/email";
import { htmlToEmailPreview } from "../web/html-to-email-preview";
import { buildDigestEmailHtml, type DigestEmailItem } from "../web/digest-email";
import { buildOwnerReaderPath } from "../web/pages/queue/owner-reader-link";

const EMAIL_FROM = "Fayner from Readplace <readplace@readplace.com>";
const DIGEST_BCC = "readplace+reader_ready@readplace.com";
const SUBJECT = "Reader views are ready for articles you saved.";
/** The reader view must have taken longer than a minute to qualify — a fast
 * generation means the saver watched it finish live and needs no nudge. */
const MIN_GENERATION_MS = 60_000;

export interface SendUserDigestDeps {
	findUserContactByUserId: FindUserContactByUserId;
	listDigestItemsByUser: ListDigestItemsByUser;
	findUserArticleNotificationState: FindUserArticleNotificationState;
	findArticleByUrl: FindArticleByUrl;
	readArticleContent: ReadArticleContent;
	deleteDigestItem: DeleteDigestItem;
	claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot;
	releaseReaderReadyEmailSlot: ReleaseReaderReadyEmailSlot;
	markReaderReadyEmailSent: MarkReaderReadyEmailSent;
	sendEmail: SendEmail;
	publishEvent: PublishEvent;
	appOrigin: string;
	cooldownMs: number;
	now: () => Date;
	logger: HutchLogger;
}

export function initSendUserDigestHandler(
	deps: SendUserDigestDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = SendUserDigestCommand.detailSchema.parse(envelope.detail);
				await processUserDigest(detail, deps);
			} catch (error) {
				deps.logger.error("[SendUserDigest] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}

/** Live-state gate for one queued article. `undefined` ⇒ include; a string ⇒
 * the stale reason (the row is dropped from the queue). Mirrors the per-article
 * gate the reader-ready pipeline enforced, reading the article's own set-once
 * `succeededAt` as the reference instant. */
function staleReason(state: UserArticleNotificationState | null): string | undefined {
	if (!state) return "row-deleted";
	if (state.status === "read") return "already-read";
	if (state.emailSentAt !== undefined) return "already-emailed";
	if (state.succeededAt === undefined) return "never-succeeded";
	const succeededAtMs = state.succeededAt.getTime();
	if (state.savedAt.getTime() > succeededAtMs) return "re-saved-after-success";
	if (succeededAtMs - state.savedAt.getTime() <= MIN_GENERATION_MS) return "under-min-generation";
	if (state.viewedAt === undefined || state.viewedAt.getTime() >= succeededAtMs) {
		return "not-viewed-while-loading";
	}
	return undefined;
}

interface IncludedItem {
	item: DigestQueueItem;
	email: DigestEmailItem;
}

async function processUserDigest(
	detail: z.infer<typeof SendUserDigestCommand.detailSchema>,
	deps: SendUserDigestDeps,
): Promise<void> {
	const userId = UserIdSchema.parse(detail.userId);
	const skip = (reason: string) => deps.logger.info("[SendUserDigest] skipped", { userId: detail.userId, reason });

	const contact = await deps.findUserContactByUserId(userId);
	if (!contact?.emailVerified) return skip("no-verified-email");

	const queued = await deps.listDigestItemsByUser(userId);
	if (queued.length === 0) return skip("empty-queue");

	const included: IncludedItem[] = [];
	const staleKeys: string[] = [];

	for (const item of queued) {
		const state = await deps.findUserArticleNotificationState({ userId, url: item.originalUrl });
		const stale = staleReason(state);
		if (stale) {
			staleKeys.push(item.url);
			deps.logger.info("[SendUserDigest] item dropped", { userId: detail.userId, url: item.url, reason: stale });
			continue;
		}
		const article = await deps.findArticleByUrl(item.originalUrl);
		if (!article) {
			staleKeys.push(item.url);
			deps.logger.info("[SendUserDigest] item dropped", { userId: detail.userId, url: item.url, reason: "article-missing" });
			continue;
		}
		const content = await deps.readArticleContent(item.originalUrl);
		included.push({
			item,
			email: {
				title: article.metadata.title,
				siteName: article.metadata.siteName,
				continueReadingUrl: `${deps.appOrigin}${buildOwnerReaderPath(article.id)}`,
				preview: content ? htmlToEmailPreview(content) : [],
			},
		});
	}

	if (included.length === 0) {
		await deleteKeys(staleKeys, userId, deps);
		return skip("no-eligible-items");
	}

	const now = deps.now();
	const claimed = await deps.claimReaderReadyEmailSlot({ userId, now, cooldownMs: deps.cooldownMs });
	// Leave every row (stale included) for the flush that owns this cycle.
	if (!claimed) return skip("rate-limited");

	try {
		await deps.sendEmail({
			from: EMAIL_FROM,
			to: contact.email,
			bcc: DIGEST_BCC,
			subject: SUBJECT,
			html: buildDigestEmailHtml({ items: included.map((i) => i.email) }),
		});
	} catch (error) {
		/* A transient send failure must not burn the user's cooldown slot: release
		 * the claim so the SQS redrive (and, if it keeps failing, the DLQ alarm)
		 * re-attempts instead of the next tick dropping the digest as rate-limited. */
		await deps.releaseReaderReadyEmailSlot({ userId, claimedAt: now });
		throw error;
	}

	/* Post-send bookkeeping is best-effort: the email is already out, so this
	 * record MUST ack — a throw would redrive and, past the cooldown, re-send.
	 * Draining the queue row is the digest's real dedup, so it runs independently
	 * of the emailSentAt stamp: a failed mark must not skip the delete, or the row
	 * re-appears next cycle and re-sends. emailSentAt only backstops a double-fail. */
	for (const { item } of included) {
		try {
			await deps.markReaderReadyEmailSent({ userId, url: item.originalUrl, at: now });
		} catch (error) {
			deps.logger.error("[SendUserDigest] mark-email-sent failed", { userId: detail.userId, url: item.url, error });
		}
	}
	await deleteKeys([...included.map(({ item }) => item.url), ...staleKeys], userId, deps);
	try {
		await deps.publishEvent(DigestEmailSentEvent, {
			userId: detail.userId,
			itemCount: included.length,
			sentAt: now.toISOString(),
		});
	} catch (error) {
		deps.logger.error("[SendUserDigest] event publish failed", { userId: detail.userId, error });
	}
	deps.logger.info("[SendUserDigest] sent digest", { userId: detail.userId, itemCount: included.length });
}

/** Best-effort removal of digest-queue rows: TTL is the backstop, so a failed
 * delete is logged, never thrown. */
async function deleteKeys(urls: string[], userId: UserId, deps: SendUserDigestDeps): Promise<void> {
	for (const url of urls) {
		try {
			await deps.deleteDigestItem({ userId, url });
		} catch (error) {
			deps.logger.error("[SendUserDigest] digest-row delete failed", { userId, url, error });
		}
	}
}
