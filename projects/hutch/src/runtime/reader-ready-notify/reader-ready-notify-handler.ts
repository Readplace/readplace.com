import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	NotifyReaderViewReadyCommand,
	ReaderReadyEmailSentEvent,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { UserIdSchema } from "@packages/domain/user";
import type {
	FindArticleByUrl,
	FindUserArticleNotificationState,
	MarkReaderReadyEmailSent,
} from "@packages/test-fixtures/providers/article-store";
import type {
	ClaimReaderReadyEmailSlot,
	FindUserContactByUserId,
} from "@packages/test-fixtures/providers/auth";
import type { SendEmail } from "@packages/test-fixtures/providers/email";
import { buildReaderReadyEmailHtml } from "../web/reader-ready-email";

const EMAIL_FROM = "Fayner from Readplace <fayner@readplace.com>";
const READER_READY_BCC = "readplace+reader_ready@readplace.com";
const SUBJECT = "Your reader view is ready";
/** The reader view must have taken longer than a minute to qualify — a fast
 * generation means the saver watched it finish live and needs no nudge. */
const MIN_GENERATION_MS = 60_000;

export interface ReaderReadyNotifyDeps {
	findUserArticleNotificationState: FindUserArticleNotificationState;
	findArticleByUrl: FindArticleByUrl;
	findUserContactByUserId: FindUserContactByUserId;
	claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot;
	markReaderReadyEmailSent: MarkReaderReadyEmailSent;
	sendEmail: SendEmail;
	publishEvent: PublishEvent;
	appOrigin: string;
	cooldownMs: number;
	now: () => Date;
	logger: HutchLogger;
}

export function initReaderReadyNotifyHandler(
	deps: ReaderReadyNotifyDeps,
): Handler<SQSEvent, SQSBatchResponse> {
	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = NotifyReaderViewReadyCommand.detailSchema.parse(envelope.detail);
				await processNotification(detail, deps);
			} catch (error) {
				deps.logger.error("[ReaderReadyNotify] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}

async function processNotification(
	detail: z.infer<typeof NotifyReaderViewReadyCommand.detailSchema>,
	deps: ReaderReadyNotifyDeps,
): Promise<void> {
	const userId = UserIdSchema.parse(detail.userId);
	const url = detail.url;
	const succeededAtMs = new Date(detail.succeededAt).getTime();
	const skip = (reason: string) =>
		deps.logger.info("[ReaderReadyNotify] skipped", { userId: detail.userId, url, reason });

	const row = await deps.findUserArticleNotificationState({ userId, url });
	if (!row) return skip("row-deleted");
	if (row.status === "read") return skip("already-read");
	if (row.savedAt.getTime() > succeededAtMs) return skip("re-saved-after-success");
	if (row.emailSentAt !== undefined) return skip("already-emailed");
	if (succeededAtMs - row.savedAt.getTime() <= MIN_GENERATION_MS) return skip("under-min-generation");
	if (row.viewedAt === undefined || row.viewedAt.getTime() >= succeededAtMs) {
		return skip("not-viewed-while-loading");
	}

	const contact = await deps.findUserContactByUserId(userId);
	if (!contact || !contact.emailVerified) return skip("no-verified-email");

	const article = await deps.findArticleByUrl(url);
	if (!article) return skip("article-missing");

	const now = deps.now();
	const claimed = await deps.claimReaderReadyEmailSlot({ userId, now, cooldownMs: deps.cooldownMs });
	if (!claimed) return skip("rate-limited");

	const readerUrl = `${deps.appOrigin}/queue/${article.id.value}/view`;
	await deps.sendEmail({
		from: EMAIL_FROM,
		to: contact.email,
		bcc: READER_READY_BCC,
		subject: SUBJECT,
		html: buildReaderReadyEmailHtml({
			readerUrl,
			title: article.metadata.title,
			siteName: article.metadata.siteName,
		}),
	});
	await deps.markReaderReadyEmailSent({ userId, url, at: now });
	await deps.publishEvent(ReaderReadyEmailSentEvent, {
		userId: detail.userId,
		url,
		sentAt: now.toISOString(),
	});
	deps.logger.info("[ReaderReadyNotify] sent reader-ready email", { userId: detail.userId, url });
}
