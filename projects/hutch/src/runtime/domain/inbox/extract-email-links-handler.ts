import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { EmailReceivedEvent } from "@packages/hutch-infra-components";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	capEmailLinks,
	type EmailLinkOrdinal,
	EmailLinkOrdinalSchema,
	type InboxEmailLinkStore,
	type InboxEmailStore,
	type ParseEmailResult,
	type ParsedEmailInlineImage,
} from "@packages/domain/inbox";
import { extractUrls } from "@packages/domain/import-session";
import { type UserId, UserIdSchema } from "@packages/domain/user";

/**
 * Consumes `EmailReceivedEvent` and turns the links found inside the email into
 * `pending` preview rows, then fans out one `CrawlEmailLinkPreview` command per
 * link (mirroring how /queue fans each import URL into its own SaveLinkCommand).
 *
 * The body is RE-DERIVED from the immutable raw `.eml` on every run — read raw →
 * re-parse → re-sanitize — so a future parse/sanitize change applies to
 * extraction too, never a body sanitized by stale logic. The per-email soft cap
 * bounds the fan-out; a truncated email still delivers the first N previews (the
 * working path) while writing a truncated meta item and raising a DLQ alert.
 */
export function initExtractEmailLinksHandler(deps: {
	getEmail: InboxEmailStore["getEmail"];
	readRawEmail: (s3Key: string) => Promise<Buffer | undefined>;
	parseEmail: (input: { raw: Buffer; receivedAt: string }) => Promise<ParseEmailResult>;
	deriveSanitizedBody: (input: { html: string; inlineImages: ParsedEmailInlineImage[] }) => string;
	putLink: InboxEmailLinkStore["putLink"];
	putLinksMeta: InboxEmailLinkStore["putLinksMeta"];
	publishCrawlPreview: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		ordinal: EmailLinkOrdinal;
		url: string;
	}) => Promise<void>;
	alertTruncated: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		found: number;
	}) => Promise<void>;
	logger: HutchLogger;
	maxLinks: number;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		getEmail,
		readRawEmail,
		parseEmail,
		deriveSanitizedBody,
		putLink,
		putLinksMeta,
		publishCrawlPreview,
		alertTruncated,
		logger,
		maxLinks,
	} = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const parsed = EmailReceivedEvent.detailSchema.safeParse(envelope.detail);
				if (!parsed.success) {
					logger.error("[extract-email-links] malformed event", { messageId: record.messageId });
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				const userId = UserIdSchema.parse(parsed.data.userId);
				const { receivedAtMessageId } = parsed.data;

				const email = await getEmail({ userId, receivedAtMessageId });
				if (email === undefined || email.status !== "received") {
					// Only `received` emails have a renderable body to extract from;
					// rejected/unparsed rows (and a row not yet visible) are skipped.
					logger.info("[extract-email-links] nothing to extract", {
						receivedAtMessageId,
						status: email?.status,
					});
					continue;
				}

				const raw = await readRawEmail(email.rawEmailS3Key);
				if (raw === undefined) {
					// S3 can be eventually consistent at receipt; retry.
					logger.warn("[extract-email-links] raw .eml not yet readable, retrying", {
						s3Key: email.rawEmailS3Key,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}

				const parsedEmail = await parseEmail({ raw, receivedAt: email.receivedAt });
				if (!parsedEmail.ok) {
					// The raw is already audited; a body that no longer parses has no links.
					logger.warn("[extract-email-links] raw no longer parseable", { receivedAtMessageId });
					continue;
				}

				const sanitizedHtml = deriveSanitizedBody({
					html: parsedEmail.email.html,
					inlineImages: parsedEmail.email.inlineImages,
				});
				const extracted = extractUrls(Buffer.from(sanitizedHtml, "utf8"));
				const { urls, truncated } = capEmailLinks(extracted, { maxLinks });

				for (const [index, url] of urls.entries()) {
					const ordinal = EmailLinkOrdinalSchema.parse(String(index).padStart(4, "0"));
					// Put the pending row BEFORE publishing so the Articles tab shows N
					// pending cards immediately; a re-delivery hits the conditional put as
					// a no-op duplicate, then re-publishes (the crawl consumer is idempotent).
					await putLink({
						userId,
						receivedAtMessageId,
						ordinal,
						url,
						status: "pending",
						title: undefined,
						excerpt: undefined,
						siteName: undefined,
						imageUrl: undefined,
						failureReason: undefined,
					});
					await publishCrawlPreview({ userId, receivedAtMessageId, ordinal, url });
				}

				// Write the per-email meta row LAST, after every link row is in place, so
				// its presence is an "extraction finished" barrier: the detail view reads
				// no-meta as "still extracting, keep polling" and meta-present-with-zero-rows
				// as the genuinely terminal "no links found" — never collapsing the two.
				await putLinksMeta({ userId, receivedAtMessageId, meta: { truncated } });

				if (truncated) {
					await alertTruncated({ userId, receivedAtMessageId, found: extracted.totalFound });
					logger.error("[extract-email-links] link cap hit, truncated", {
						receivedAtMessageId,
						found: extracted.totalFound,
						kept: urls.length,
					});
				}
				logger.info("[extract-email-links] extracted", {
					receivedAtMessageId,
					links: urls.length,
				});
			} catch (error) {
				logger.error("[extract-email-links] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
