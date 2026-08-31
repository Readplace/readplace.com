import assert from "node:assert";
import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { decodeHtmlEntities } from "@packages/crawl-article";
import { EmailReceivedEvent } from "@packages/hutch-infra-components";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { resolveWriteAccess } from "@packages/subscription-access";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	capEmailLinks,
	classifyEmailLink,
	type EmailLinkOrdinal,
	type EmailLinkStatus,
	formatEmailLinkOrdinal,
	type InboxEmailLinkEntry,
	type InboxEmailLinkStore,
	type InboxEmailStore,
	type ParseEmailResult,
	type ParsedEmailInlineImage,
} from "@packages/domain/inbox";
import { UNROUTED_USER_ID } from "@packages/domain/inbox";
import { extractUrls } from "@packages/domain/import-session";
import { validateSaveableUrl } from "@packages/domain/article";
import type { SaveProvenance } from "@packages/domain/article";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { collectEmailAnchors } from "./collect-email-anchors";
import { LLM_SKIP_REASONS, type TriageEmailLinks } from "./triage-email-links";

/**
 * Consumes `EmailReceivedEvent` and turns the links found inside the email into
 * `pending` preview rows, then fans out one `CrawlEmailLinkPreview` command per
 * link plus — for a routed user's saveable links — one `SubmitLinkCommand` per
 * link, which lands the article in the reader's unread queue through the same
 * entry point every save surface uses (mirroring how /queue fans each import
 * URL into its own save command). Links classified as action links (a GET could
 * unsubscribe or confirm on the reader's behalf) are written as terminal
 * `skipped` rows and never fanned out.
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
	deriveSanitizedBody: (input: {
		html: string;
		inlineImages: ParsedEmailInlineImage[];
		rehostedRemoteImages: Record<string, string>;
	}) => string;
	putLink: InboxEmailLinkStore["putLink"];
	getLink: InboxEmailLinkStore["getLink"];
	putLinksMeta: InboxEmailLinkStore["putLinksMeta"];
	setEmailLinkCounts: InboxEmailStore["setEmailLinkCounts"];
	publishCrawlPreview: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		ordinal: EmailLinkOrdinal;
		url: string;
	}) => Promise<void>;
	publishSubmitLink: (input: {
		userId: UserId;
		url: string;
		provenance: SaveProvenance;
	}) => Promise<void>;
	alertTruncated: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		found: number;
	}) => Promise<void>;
	publishSaveHeldNotice: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		inboxAddress: string;
	}) => Promise<void>;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	now: () => Date;
	triageEmailLinks: TriageEmailLinks;
	logger: HutchLogger;
	maxLinks: number;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		getEmail,
		readRawEmail,
		parseEmail,
		deriveSanitizedBody,
		putLink,
		getLink,
		putLinksMeta,
		setEmailLinkCounts,
		publishCrawlPreview,
		publishSubmitLink,
		alertTruncated,
		publishSaveHeldNotice,
		findSubscriptionByUserId,
		now,
		triageEmailLinks,
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
				const { receivedAtMessageId, origin, recipientAddress } = parsed.data;

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
					// A body that does not parse has no links to extract.
					logger.warn("[extract-email-links] raw no longer parseable", { receivedAtMessageId });
					continue;
				}

				// Extraction reads only <a href>s, so no remote-image rehost map: CDN
				// image URLs in the derived body would surface as phantom article links,
				// and building the map would re-download every image on every run.
				const sanitizedHtml = deriveSanitizedBody({
					html: parsedEmail.email.html,
					inlineImages: parsedEmail.email.inlineImages,
					rehostedRemoteImages: {},
				});
				// Decode before extracting so the stored, classified, and crawled URL is
				// the href as parsed, not its serialized form (`?a=1&amp;b=2`).
				const extracted = extractUrls(Buffer.from(decodeHtmlEntities(sanitizedHtml), "utf8"));
				const { urls, truncated } = capEmailLinks(extracted, { maxLinks });

				const links = urls.map((url, index) => ({
					url,
					ordinal: formatEmailLinkOrdinal(index),
					classification: classifyEmailLink({
						url,
						listUnsubscribeUrls: parsedEmail.email.listUnsubscribeUrls,
					}),
				}));
				const crawlCandidates = links.filter((link) => link.classification.action === "crawl");
				// One batched triage call per email; `unavailable` fails open so previews
				// never depend on the model being up.
				let triage: Awaited<ReturnType<TriageEmailLinks>> | undefined;
				if (crawlCandidates.length > 0) {
					const anchors = collectEmailAnchors(sanitizedHtml);
					triage = await triageEmailLinks({
						subject: email.subject,
						from: email.senderEmail,
						links: crawlCandidates.map((link) => ({
							ordinal: link.ordinal,
							url: link.url,
							anchorText: anchors.get(link.url) ?? "",
						})),
					});
				}

				const storedLinkStatus = async (row: InboxEmailLinkEntry): Promise<EmailLinkStatus> => {
					const putResult = await putLink(row);
					if (putResult === "stored") return row.status;
					const existing = await getLink({ userId, receivedAtMessageId, ordinal: row.ordinal });
					assert(existing, "conditional put reported a duplicate but the row is missing");
					return existing.status;
				};

				const canSubmit = origin === "receive" && userId !== UNROUTED_USER_ID;
				const writeAccess = canSubmit
					? resolveWriteAccess(await findSubscriptionByUserId(userId), now())
					: undefined;

				let kept = 0;
				let skipped = 0;
				let held = 0;
				let noticePublished = false;
				const countStored = (status: EmailLinkStatus) => {
					if (status === "skipped") skipped += 1;
					else kept += 1;
				};
				for (const { url, ordinal, classification } of links) {
					const link = {
						userId,
						receivedAtMessageId,
						ordinal,
						url,
						resolvedUrl: undefined,
						title: undefined,
						excerpt: undefined,
						siteName: undefined,
						imageUrl: undefined,
						failureReason: undefined,
					};
					if (classification.action === "skip") {
						// Terminal at birth: a skipped link is never crawled, so no
						// CrawlEmailLinkPreview is published for it and its card never polls.
						countStored(
							await storedLinkStatus({ ...link, status: "skipped", skipReason: classification.reason }),
						);
						continue;
					}
					const category =
						triage?.status === "triaged" ? triage.categories.get(ordinal) : undefined;
					if (category !== undefined && category !== "article") {
						countStored(
							await storedLinkStatus({
								...link,
								status: "skipped",
								skipReason: LLM_SKIP_REASONS[category],
							}),
						);
						continue;
					}
					// Put the pending row BEFORE publishing so the Articles tab shows N
					// pending cards immediately; a re-delivery hits the conditional put as
					// a no-op duplicate, then re-publishes while the row is still pending
					// (the crawl consumer is idempotent).
					const status = await storedLinkStatus({ ...link, status: "pending", skipReason: undefined });
					countStored(status);
					// Triage verdicts are not deterministic across re-deliveries: a row a
					// previous delivery terminally skipped must never be crawled by a
					// later delivery that judged the same URL an article.
					if (status !== "pending") continue;
					// Submit BEFORE the preview publish: the preview consumer flips this
					// row terminal, so a crash after the preview went out would make the
					// retry's pending-gate skip a submit that never happened. A crash
					// after the submit leaves the row pending and the retry re-publishes
					// both; the duplicate submit converges in the subscriber.
					if (canSubmit && validateSaveableUrl(url).status === "SUCCESS") {
						if (writeAccess === "full") {
							await publishSubmitLink({
								userId,
								url,
								provenance: { kind: "email", senderEmail: email.senderEmail },
							});
						} else {
							held += 1;
							if (!noticePublished) {
								noticePublished = true;
								await publishSaveHeldNotice({
									userId,
									receivedAtMessageId,
									inboxAddress: recipientAddress,
								});
							}
						}
					}
					await publishCrawlPreview({ userId, receivedAtMessageId, ordinal, url });
				}

				if (held > 0) {
					logger.info("[extract-email-links] saves held for a read-only reader", {
						userId,
						receivedAtMessageId,
						held,
					});
				}

				await setEmailLinkCounts({
					userId,
					receivedAtMessageId,
					linkCounts: { kept, skipped, truncated },
				});
				// Write the per-email meta row LAST, after every link row is in place, so
				// its presence is an "extraction finished" barrier: the detail view reads
				// no-meta as "still extracting, keep polling" and meta-present-with-zero-rows
				// as the genuinely terminal "no links found" — never collapsing the two.
				await putLinksMeta({
					userId,
					receivedAtMessageId,
					meta: { truncated, extractionFailed: false },
				});

				if (truncated) {
					await alertTruncated({ userId, receivedAtMessageId, found: extracted.totalFound });
					logger.error("[extract-email-links] link cap hit, truncated", {
						receivedAtMessageId,
						found: extracted.totalFound,
						capped: urls.length,
					});
				}
				logger.info("[extract-email-links] extracted", {
					receivedAtMessageId,
					links: urls.length,
					kept,
					skipped,
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
