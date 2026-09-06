import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import { ReaderReadyEmailSentEvent, SendUserDigestCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { UserIdSchema } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import type {
	FindArticleByUrl,
	FindUserArticleNotificationState,
	MarkReaderReadyEmailSent,
	UserArticleNotificationState,
} from "@packages/provider-contracts/article-store";
import type { FindGeneratedSummary } from "@packages/provider-contracts/article-summary";
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
import { EmailRejectedError, type SendEmail } from "@packages/provider-contracts/email";
import { buildDigestPreview } from "../web/digest-preview";
import { buildDigestEmailHtml, type DigestEmailItem } from "../web/digest-email";
import { buildOwnerReaderPath } from "../web/pages/readlist/owner-reader-link";

const EMAIL_FROM = "Fayner from Readplace <fayner@readplace.com>";
const EMAIL_REPLY_TO = "fayner@readplace.com";
const DIGEST_BCC = "readplace+reader_ready@readplace.com";
const SUBJECT = "Reader views are ready for articles you saved.";
/** The article body must have been unavailable for longer than a minute to
 * qualify — a fast crawl means the saver watched it land live and needs no nudge. */
const MIN_UNAVAILABLE_MS = 60_000;

export interface SendUserDigestDeps {
	findUserContactByUserId: FindUserContactByUserId;
	listDigestItemsByUser: ListDigestItemsByUser;
	findUserArticleNotificationState: FindUserArticleNotificationState;
	findArticleByUrl: FindArticleByUrl;
	findGeneratedSummary: FindGeneratedSummary;
	deleteDigestItem: DeleteDigestItem;
	claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot;
	releaseReaderReadyEmailSlot: ReleaseReaderReadyEmailSlot;
	markReaderReadyEmailSent: MarkReaderReadyEmailSent;
	sendEmail: SendEmail;
	publishEvent: PublishEvent;
	appOrigin: string;
	cooldownMs: number;
	/** Upper bound on articles resolved and emailed per digest; overflow rows
	 * stay queued for the next tick. Guards the Lambda timeout on a large backlog. */
	maxDigestItems: number;
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
				await processUserDigest({ detail, messageId: record.messageId, deps });
			} catch (error) {
				deps.logger.error("[SendUserDigest] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}

/** Live-state gate for one queued article. `undefined` ⇒ include; a string ⇒
 * the stale reason (the row is dropped from the queue). The reference instant is
 * the article's global set-once `readerAvailableAt` — when the body became
 * renderable — because that, not the moment both axes finished, is what the
 * reader was waiting for. */
function staleReason(params: {
	state: UserArticleNotificationState | null;
	readerAvailableAt: Date | undefined;
}): string | undefined {
	const { state, readerAvailableAt } = params;
	if (!state) return "row-deleted";
	if (state.status === "read") return "already-read";
	if (state.emailSentAt !== undefined) return "already-emailed";
	if (readerAvailableAt === undefined) return "reader-availability-unrecorded";
	const availableAtMs = readerAvailableAt.getTime();
	if (state.savedAt.getTime() > availableAtMs) return "saved-after-reader-available";
	if (availableAtMs - state.savedAt.getTime() <= MIN_UNAVAILABLE_MS) {
		return "available-too-soon-after-save";
	}
	if (state.viewedAt === undefined || state.viewedAt.getTime() >= availableAtMs) {
		return "not-viewed-while-loading";
	}
	return undefined;
}

interface IncludedItem {
	item: DigestQueueItem;
	email: DigestEmailItem;
}

async function processUserDigest(params: {
	detail: z.infer<typeof SendUserDigestCommand.detailSchema>;
	messageId: string;
	deps: SendUserDigestDeps;
}): Promise<void> {
	const { detail, messageId, deps } = params;
	const userId = UserIdSchema.parse(detail.userId);
	const skip = (reason: string) => deps.logger.info("[SendUserDigest] skipped", { userId: detail.userId, reason });

	const contact = await deps.findUserContactByUserId(userId);
	if (!contact?.emailVerified) return skip("no-verified-email");

	const queued = await deps.listDigestItemsByUser(userId);
	if (queued.length === 0) return skip("empty-queue");

	/* Newest first (the queue lists in canonical-url order), then bound the batch:
	 * each item costs several reads, so an unbounded backlog could exceed the
	 * Lambda timeout *after* the slot is claimed and starve the digest until TTL.
	 * Overflow rows stay queued and drain on the next tick. Items are resolved
	 * concurrently, so distinct items never wait on each other. */
	const batch = [...queued]
		.sort((a, b) => Date.parse(b.enqueuedAt) - Date.parse(a.enqueuedAt))
		.slice(0, deps.maxDigestItems);
	const resolved = await Promise.all(batch.map((item) => resolveDigestItem(item, userId, deps)));

	const included: IncludedItem[] = [];
	const staleKeys: string[] = [];
	for (const { item, email } of resolved) {
		if (email) included.push({ item, email });
		else staleKeys.push(item.url);
	}

	if (included.length === 0) {
		await deleteKeys(staleKeys, userId, deps);
		return skip("no-eligible-items");
	}

	const now = deps.now();
	const claim = await deps.claimReaderReadyEmailSlot({ userId, now, cooldownMs: deps.cooldownMs, messageId });
	if (!claim.claimed) {
		/* Leave every row (stale included) for the flush that owns this cycle.
		 * A message that reaches here after its own claim would be a swallowed
		 * redrive, so this is a warn: the cooldown outlasts the redrive envelope
		 * precisely to make that unreachable. */
		deps.logger.warn("[SendUserDigest] rate-limited", { userId: detail.userId, messageId });
		return;
	}

	if (claim.redelivery) {
		/* This message already claimed the slot on an earlier receive, so the email
		 * may already be out. Re-sending is the duplicate; what the crashed attempt
		 * failed to do is drain. Rows enqueued after that claim were never in the
		 * email, so they stay queued for the next tick instead of being drained
		 * unsent. */
		const claimedAtMs = claim.claimedAt.getTime();
		const alreadyEmailed = included.filter(({ item }) => Date.parse(item.enqueuedAt) <= claimedAtMs);
		return finishDigest({ included: alreadyEmailed, staleKeys, userId, now, redelivery: true, deps });
	}

	try {
		await deps.sendEmail({
			from: EMAIL_FROM,
			to: contact.email,
			bcc: DIGEST_BCC,
			replyTo: EMAIL_REPLY_TO,
			subject: SUBJECT,
			html: buildDigestEmailHtml({
				items: included.map((i) => i.email),
				queueUrl: `${deps.appOrigin}/queue`,
			}),
		});
	} catch (error) {
		/* Release only on a provider-confirmed rejection, where a retry cannot
		 * duplicate: the redrive then re-claims and genuinely re-sends. An
		 * ambiguous failure keeps the claim, so the redrive lands on the
		 * redelivery branch and drains rather than risking a second copy. */
		if (error instanceof EmailRejectedError) {
			await deps.releaseReaderReadyEmailSlot({ userId, claimedAt: now, messageId });
		}
		throw error;
	}

	await finishDigest({ included, staleKeys, userId, now, redelivery: false, deps });
}

/* Post-send bookkeeping is best-effort: the email is already out, so this record
 * MUST ack — a throw would redrive and, past the cooldown, re-send. Draining the
 * queue row is the digest's real dedup, so it runs independently of the
 * emailSentAt stamp: a failed mark must not skip the delete, or the row
 * re-appears next cycle and re-sends. emailSentAt only backstops a double-fail. */
async function finishDigest(params: {
	included: IncludedItem[];
	staleKeys: string[];
	userId: UserId;
	now: Date;
	redelivery: boolean;
	deps: SendUserDigestDeps;
}): Promise<void> {
	const { included, staleKeys, userId, now, redelivery, deps } = params;

	for (const { item } of included) {
		try {
			await deps.markReaderReadyEmailSent({ userId, url: item.originalUrl, at: now });
		} catch (error) {
			deps.logger.error("[SendUserDigest] mark-email-sent failed", { userId, url: item.url, error });
		}
	}
	await deleteKeys([...included.map(({ item }) => item.url), ...staleKeys], userId, deps);
	if (included.length > 0) {
		try {
			await deps.publishEvent(ReaderReadyEmailSentEvent, {
				userId,
				urls: included.map(({ item }) => item.originalUrl),
				sentAt: now.toISOString(),
			});
		} catch (error) {
			deps.logger.error("[SendUserDigest] event publish failed", { userId, error });
		}
	}
	deps.logger.info("[SendUserDigest] sent digest", { userId, itemCount: included.length, redelivery });
}

/** Re-validate one queued article against live state and project it to an email
 * item. `email` present ⇒ include it; `email` undefined ⇒ drop the (stale) row.
 * The per-user row and the article are both gate inputs so they are read
 * together; only the summary read waits on the gate passing. */
async function resolveDigestItem(
	item: DigestQueueItem,
	userId: UserId,
	deps: SendUserDigestDeps,
): Promise<{ item: DigestQueueItem; email: DigestEmailItem | undefined }> {
	const drop = (reason: string) => {
		deps.logger.info("[SendUserDigest] item dropped", { userId, url: item.url, reason });
		return { item, email: undefined };
	};

	const [state, article] = await Promise.all([
		deps.findUserArticleNotificationState({ userId, url: item.originalUrl }),
		deps.findArticleByUrl(item.originalUrl),
	]);
	if (!article) return drop("article-missing");

	const stale = staleReason({ state, readerAvailableAt: article.readerAvailableAt });
	if (stale) return drop(stale);

	const summary = await deps.findGeneratedSummary(item.originalUrl);
	return {
		item,
		email: {
			title: article.metadata.title,
			siteName: article.metadata.siteName,
			readerUrl: digestReaderUrl({
				appOrigin: deps.appOrigin,
				path: buildOwnerReaderPath(article.id),
			}),
			preview: buildDigestPreview(summary),
		},
	};
}

function digestReaderUrl(input: { appOrigin: string; path: string }): string {
	const url = new URL(input.path, input.appOrigin);
	url.searchParams.set("utm_source", "reader-ready-email");
	url.searchParams.set("utm_medium", "email");
	url.searchParams.set("utm_content", "article");
	return url.toString();
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
