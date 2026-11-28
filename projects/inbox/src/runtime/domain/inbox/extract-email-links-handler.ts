import assert from "node:assert";
import { decodeHtmlEntities } from "@packages/crawl-article";
import type { SaveAttemptId, SaveProvenance, SaveTrigger } from "@packages/domain/article";
import { newSaveAttemptId } from "@packages/domain/article";
import { validateSaveableInboxLink } from "./saveable-inbox-link";
import { extractUrls } from "@packages/domain/import-session";
import {
	capEmailLinks,
	classifyEmailLink,
	classifyForwardedEmailLink,
	type EmailImportCompletionStore,
	type EmailOutputKey,
	type EmailOutputSelection,
	type InboxArticleDestination,
	emailMatchBatch,
	ISSUE_OUTPUT_KEY,
	linkOutputKey,
	outputLinkOrdinal,
	type EmailLinkOrdinal,
	type EmailLinkStatus,
	formatEmailLinkOrdinal,
	type InboxAddress,
	InboxAddressSchema,
	type InboxAddressStore,
	type InboxEmailLinkEntry,
	type InboxEmailLinkStore,
	type InboxEmailStore,
	inboxEmailPath,
	type ParsedEmailInlineImage,
	type ParseEmailResult,
	UNROUTED_USER_ID,
} from "@packages/domain/inbox";
import {
	DEFAULT_READLIST_SLUG,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import {
	type EmailReceivedDetail,
	EmailReceivedEvent,
} from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type { ListReadlistDefinitions } from "@packages/provider-contracts/article-store";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { hasPaidFeatures, resolveEffectiveAccess } from "@packages/subscription-access";
import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { collectEmailAnchors } from "./collect-email-anchors";
import { resolveEmailFanOut } from "./email-fan-out";
import { LLM_SKIP_REASONS, type TriageEmailLinks } from "./triage-email-links";

export const TRIAGED_ANCHOR_TEXT_MAX_CHARS = 120;

// Keep the triage request and downstream event bounded when the per-email limit increases.
const LINKS_PER_EXTRACTION = 300;

export interface EmailOutputCorrelation {
	receivedAtMessageId: string;
	outputKey: EmailOutputKey;
}

const SUBMITTING_ORIGINS: Record<EmailReceivedDetail["origin"], boolean> = {
	receive: true,
	backfill: false,
	"gmail-import": true,
};

/**
 * Consumes `EmailReceivedEvent` and turns the links found inside the email into
 * `pending` preview rows, then fans out one `CrawlEmailLinkPreview` command per
 * link plus — for a routed user's saveable links — one `SubmitLinkCommand` per
 * link, which lands the article in the reader's unread queue through the same
 * entry point every save surface uses (mirroring how /queue fans each import
 * URL into its own save command).
 *
 * The body is RE-DERIVED from the immutable raw `.eml` on every run — read raw →
 * re-parse → re-sanitize — so a future parse/sanitize change applies to
 * extraction too, never a body sanitized by stale logic. The per-email soft cap
 * bounds the fan-out; a truncated email still delivers its initial previews, then enqueues work at the recorded link position.
 */
export function initExtractEmailLinksHandler(deps: {
	getEmail: InboxEmailStore["getEmail"];
	readRawEmail: (s3Key: string) => Promise<Buffer | undefined>;
	parseEmail: (input: {
		raw: Buffer;
		receivedAt: string;
	}) => Promise<ParseEmailResult>;
	deriveSanitizedBody: (input: {
		html: string;
		inlineImages: ParsedEmailInlineImage[];
		rehostedRemoteImages: Record<string, string>;
	}) => string;
	putLink: InboxEmailLinkStore["putLink"];
	getLink: InboxEmailLinkStore["getLink"];
	listLinksByEmail: InboxEmailLinkStore["listLinksByEmail"];
	putLinksMeta: InboxEmailLinkStore["putLinksMeta"];
	findLinksMeta: InboxEmailLinkStore["findLinksMeta"];
	markWindowDispatched: InboxEmailLinkStore["markWindowDispatched"];
	setEmailLinkCounts: InboxEmailStore["setEmailLinkCounts"];
	publishCrawlPreview: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		ordinal: EmailLinkOrdinal;
		url: string;
	}) => Promise<void>;
	publishSubmitLink: (input: {
		requestedAt: string;
		userId: UserId;
		url: string;
		provenance: SaveProvenance;
		readlist: ReadlistSlug;
		saveTrigger: SaveTrigger;
		saveAttemptId: SaveAttemptId;
		emailOutput: EmailOutputCorrelation;
	}) => Promise<void>;
	publishEmailLinksTriaged: (input: {
		scope: "email";
		startIndex?: number;
		userId: UserId;
		receivedAtMessageId: string;
		readlist: ReadlistSlug;
		senderEmail: string;
		subject: string;
		links: { ordinal: EmailLinkOrdinal; url: string; anchorText: string }[];
	}) => Promise<void>;
	publishSaveEmailIssue: (input: {
		requestedAt: string;
		userId: UserId;
		saveAttemptId: SaveAttemptId;
		receivedAtMessageId: string;
		subject: string;
		senderEmail: string;
		senderName: string;
		issueUrl: string;
		readlists: ReadlistSlug[];
		emailOutput: EmailOutputCorrelation;
	}) => Promise<void>;
	findCompletion: EmailImportCompletionStore["findCompletion"];
	selectOutputs: EmailImportCompletionStore["selectOutputs"];
	amendSelection: EmailImportCompletionStore["amendSelection"];
	publishEmailOutputsSelected: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		outputCount: number;
		supplemental?: true;
	}) => Promise<void>;
	enqueueContinuation: (detail: EmailReceivedDetail) => Promise<void>;
	publishExtraction: (detail: EmailReceivedDetail) => Promise<void>;
	publishSaveHeldNotice: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		inboxAddress: string;
	}) => Promise<void>;
	publishFirstInboxEmailNotice: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		inboxAddress: string;
	}) => Promise<void>;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	findInboxAddress: InboxAddressStore["findByAddress"];
	listReadlistDefinitions: ListReadlistDefinitions;
	now: () => Date;
	triageEmailLinks: TriageEmailLinks;
	logger: Logger;
	maxLinks: number;
	appOrigin: string;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		getEmail,
		readRawEmail,
		parseEmail,
		deriveSanitizedBody,
		putLink,
		getLink,
		listLinksByEmail,
		putLinksMeta,
		setEmailLinkCounts,
		publishCrawlPreview,
		publishSubmitLink,
		publishEmailLinksTriaged,
		publishSaveEmailIssue,
		findCompletion,
		selectOutputs,
		publishEmailOutputsSelected,
		enqueueContinuation,
		publishSaveHeldNotice,
		publishFirstInboxEmailNotice,
		findSubscriptionByUserId,
		findInboxAddress,
		listReadlistDefinitions,
		now,
		triageEmailLinks,
		logger,
		maxLinks,
		appOrigin,
	} = deps;

	const findRoutedReadlist = async (input: {
		userId: UserId;
		address: InboxAddress;
	}): Promise<ReadlistSlug | undefined> => {
		const entry = await findInboxAddress(input.address);
		assert(entry, "a received email's inbox address is never deleted");
		if (
			entry.userId !== input.userId ||
			entry.readlist === DEFAULT_READLIST_SLUG
		)
			return undefined;
		return entry.readlist;
	};

	const destinationsFor = async (detail: EmailReceivedDetail, paid: boolean): Promise<{
		articles: InboxArticleDestination[];
		issue: InboxArticleDestination[];
	}> => {
		const { userId, recipientAddress, routing } = detail;
		const routes = new Set<ReadlistSlug>();
		const addresses = routing.kind === "inbox" ? [recipientAddress] : routing.destinationAddresses;
		for (const address of new Set(addresses)) {
			const readlist = await findRoutedReadlist({ userId, address: InboxAddressSchema.parse(address) });
			if (readlist !== undefined) routes.add(readlist);
		}
		const definitions = paid || routes.size > 0 ? await listReadlistDefinitions(userId) : [];
		const explicit = [...routes].map((readlist) => ({
			readlist, label: definitions.find((definition) => definition.slug === readlist)?.label ?? "Deleted readlist",
		}));
		const fanOut = resolveEmailFanOut({ routing });
		const articles: Map<ReadlistSlug, InboxArticleDestination> = new Map(
			(fanOut.links ? explicit : []).map((destination) => [destination.readlist, destination]),
		);
		if (paid) {
			for (const { slug, label, filing } of definitions) {
				if (slug === DEFAULT_READLIST_SLUG || filing?.mode !== "smart") continue;
				articles.set(slug, { readlist: slug, label, qualification: articles.has(slug) ? "route-and-preferences" : "preferences" });
			}
		}
		return { articles: [...articles.values()], issue: explicit };
	};

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const parsed = EmailReceivedEvent.detailSchema.safeParse(
					envelope.detail,
				);
				if (!parsed.success) {
					logger.error("[extract-email-links] malformed event", {
						messageId: record.messageId,
					});
					batchItemFailures.push({ itemIdentifier: record.messageId });
					continue;
				}
				const userId = parsed.data.userId;
				const { receivedAtMessageId, origin, recipientAddress, routing, supplemental } =
					parsed.data;

				const key = { userId, receivedAtMessageId };
				const start = parsed.data.startIndex ?? 0;
				const prior = await deps.findLinksMeta(key);
				const window = prior?.extractionWindow;
				if (envelope.recovery === true) {
					if (!prior?.truncated || window?.end !== start) continue;
					// Only the cap gate runs on the recovery queue. Parsing, storage and
					// publishing failures retain the ordinary extractor's redrive path.
					assert(maxLinks > start, "the deployed email link limit must increase before redrive");
					await deps.publishExtraction(parsed.data);
					continue;
				}
				if (!supplemental && window && (window.start > start || (window.start === start && prior?.dispatchedThrough === window.end))) continue;
				if (start > 0 && window?.end !== start && window?.start !== start) continue;
				if (start > 0 && maxLinks <= start) {
					await enqueueContinuation(parsed.data);
					continue;
				}

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

				const acceptedWork = supplemental ? await findCompletion(key) : undefined;
				const work = acceptedWork?.supplementalImport;
				if (supplemental) assert(work, "supplemental imports are recorded before dispatch");

				const previous = supplemental ? await listLinksByEmail(key) : undefined;
				const cached = previous?.meta?.extractionFailed === false
					? { links: previous.links, meta: previous.meta }
					: undefined;
				let links: { url: string; ordinal: EmailLinkOrdinal; classification: ReturnType<typeof classifyEmailLink> }[];
				let anchors: ReadonlyMap<string, string | undefined>;
				let senderName: string;
				let truncated: boolean;
				let end: number;
				let extractionWindow: { start: number; end: number } | undefined;
				let truncatedLinkCount: number | undefined;
				if (cached !== undefined) {
					assert(work, "only supplemental imports reuse existing extraction");
					links = cached.links
						.filter((link) => link.status !== "skipped")
						.map(({ url, ordinal }) => ({ url, ordinal, classification: { action: "crawl" } }));
					anchors = new Map(cached.links.map((link) => [link.url, link.anchorText]));
					senderName = work.senderName;
					truncated = cached.meta.truncated;
					end = cached.links.length;
					extractionWindow = undefined;
				} else {
					const raw = await readRawEmail(email.rawEmailS3Key) ??
						(work && await readRawEmail(work.rawEmailS3Key));
					if (raw === undefined) {
						logger.warn("[extract-email-links] raw .eml not yet readable, retrying", {
							s3Key: email.rawEmailS3Key,
						});
						batchItemFailures.push({ itemIdentifier: record.messageId });
						continue;
					}
					const parsedEmail = await parseEmail({ raw, receivedAt: email.receivedAt });
					if (!parsedEmail.ok) {
						logger.warn("[extract-email-links] raw no longer parseable", { receivedAtMessageId });
						continue;
					}

					const sanitizedHtml = deriveSanitizedBody({
						html: parsedEmail.email.html,
						inlineImages: parsedEmail.email.inlineImages,
						rehostedRemoteImages: {},
					});
					const batchLimit = window?.start === start ? window.end : Math.min(maxLinks, start + LINKS_PER_EXTRACTION);
					const extracted = extractUrls(Buffer.from(decodeHtmlEntities(sanitizedHtml), "utf8"), batchLimit);
					const capped = capEmailLinks(extracted, { maxLinks: batchLimit });
					end = capped.urls.length;
					const classifyLink =
						origin === "receive" && routing.kind === "inbox" && userId !== UNROUTED_USER_ID
							? classifyForwardedEmailLink
							: classifyEmailLink;
					links = capped.urls.slice(start).map((url, index) => ({
						url,
						ordinal: formatEmailLinkOrdinal(start + index),
						classification: classifyLink({ url, listUnsubscribeUrls: parsedEmail.email.listUnsubscribeUrls }),
					}));
					anchors = collectEmailAnchors(sanitizedHtml);
					senderName = parsedEmail.email.fromName;
					truncated = capped.truncated;
					extractionWindow = truncated || start > 0 ? { start, end } : undefined;
					if (truncated) truncatedLinkCount = extracted.totalFound;
				}

				const crawlCandidates = links.filter((link) => link.classification.action === "crawl");
				const linkStatuses = new Map(cached?.links.map((link) => [link.ordinal, link.status]));
				const canSubmit =
					SUBMITTING_ORIGINS[origin] && userId !== UNROUTED_USER_ID;
				const paidFeatures = canSubmit
					? hasPaidFeatures(resolveEffectiveAccess(await findSubscriptionByUserId(userId), now()))
					: undefined;
				const savesHeld = paidFeatures === false;
				const tracksImport = routing.kind === "gmail" && paidFeatures === true;
				const completion = paidFeatures === true
					? acceptedWork ?? await findCompletion(key)
					: undefined;
				const frozenSelection = tracksImport
					? supplemental
						? completion?.supplementalSelection
						: start === 0 || completion?.selection?.nextLinkIndex !== start ? completion?.selection : undefined
					: undefined;
				const alreadySaved = (outputKey: EmailOutputKey) =>
					completion?.savedOutputs.has(outputKey) === true;
				// One batched triage call per email; `unavailable` fails open so previews
				// never depend on the model being up.
				let triage: Awaited<ReturnType<TriageEmailLinks>> | undefined;
				if (crawlCandidates.length > 0 && frozenSelection === undefined && !savesHeld && cached === undefined) {
					triage = await triageEmailLinks({
						userId,
						receivedAtMessageId,
						subject: email.subject,
						from: email.senderEmail,
						links: crawlCandidates.map((link) => ({
							ordinal: link.ordinal,
							url: link.url,
							anchorText: anchors.get(link.url) ?? "",
						})),
					});
				}

				const storedLinkStatus = async (
					row: InboxEmailLinkEntry,
				): Promise<EmailLinkStatus> => {
					const previousStatus = linkStatuses.get(row.ordinal);
					if (previousStatus !== undefined) return previousStatus;
					const putResult = await putLink(row);
					if (putResult === "stored") return row.status;
					const existing = await getLink({
						userId,
						receivedAtMessageId,
						ordinal: row.ordinal,
					});
					assert(
						existing,
						"conditional put reported a duplicate but the row is missing",
					);
					return existing.status;
				};

				const fanOut = resolveEmailFanOut({ routing });
				const destinations = !supplemental && prior && !prior.extractionFailed
					? { articles: prior.selectedReadlists ?? [], issue: prior.issueSave?.readlists ?? [] }
					: canSubmit ? await destinationsFor(parsed.data, paidFeatures === true) : { articles: [], issue: [] };
				let selectedReadlists = destinations.articles;
				let issueReadlists = destinations.issue;
				const triagedLinks: {
					ordinal: EmailLinkOrdinal;
					url: string;
					anchorText: string;
				}[] = [];

				let kept = 0;
				let skipped = 0;
				let held = 0;
				let noticePublished = false;
				let firstInboxNoticePublished = false;
				const requestedAt = new Date(envelope.time ?? email.receivedAt).toISOString();
				const saveIssue = (emailOutput: EmailOutputCorrelation) =>
					publishSaveEmailIssue({
						requestedAt,
						userId,
						saveAttemptId: newSaveAttemptId(),
						receivedAtMessageId,
						subject: email.subject,
						senderEmail: email.senderEmail,
						senderName,
						issueUrl: `${appOrigin}${inboxEmailPath(receivedAtMessageId)}`,
						readlists: issueReadlists.map(({ readlist }) => readlist),
						emailOutput,
					});
				const submitToAll = (input: { url: string; emailOutput: EmailOutputCorrelation }) =>
					publishSubmitLink({
						requestedAt: start > 0 ? email.receivedAt : requestedAt,
						userId,
						url: input.url,
						provenance: { kind: "email", senderEmail: email.senderEmail },
						readlist: DEFAULT_READLIST_SLUG,
						saveTrigger: "automatic",
						saveAttemptId: newSaveAttemptId(),
						emailOutput: input.emailOutput,
					});
				const publishHeldNoticeOnce = async () => {
					if (noticePublished) return;
					noticePublished = true;
					await publishSaveHeldNotice({
						userId,
						receivedAtMessageId,
						inboxAddress: recipientAddress,
					});
				};
				if (savesHeld && fanOut.issue) await publishHeldNoticeOnce();
				const countStored = (status: EmailLinkStatus) => {
					if (status === "skipped") skipped += 1;
					else kept += 1;
				};
				for (const { url, ordinal, classification } of links) {
					const anchorText = (anchors.get(url) ?? "").slice(
						0,
						TRIAGED_ANCHOR_TEXT_MAX_CHARS,
					);
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
						anchorText,
					};
					if (classification.action === "skip") {
						// Terminal at birth: a skipped link is never crawled, so no
						// CrawlEmailLinkPreview is published for it and its card never polls.
						countStored(
							await storedLinkStatus({
								...link,
								status: "skipped",
								skipReason: classification.reason,
							}),
						);
						continue;
					}
					if (savesHeld) {
						countStored(
							await storedLinkStatus({
								...link,
								status: "skipped",
								skipReason: "paid-plan",
							}),
						);
						if (fanOut.links && validateSaveableInboxLink(url).status === "SUCCESS") {
							held += 1;
							await publishHeldNoticeOnce();
						}
						continue;
					}
					const category =
						triage?.status === "triaged"
							? triage.categories.get(ordinal)
							: undefined;
					if (category !== undefined && category !== "article") {
						const status = await storedLinkStatus({
							...link,
							status: "skipped",
							skipReason: LLM_SKIP_REASONS[category],
						});
						if (status === "skipped") {
							countStored(status);
							continue;
						}
					}
					// Put the pending row BEFORE publishing so the Articles tab shows N
					// pending cards immediately; a re-delivery hits the conditional put as
					// a no-op duplicate, then re-publishes while the row is still pending
					// (the crawl consumer is idempotent).
					const status = await storedLinkStatus({
						...link,
						status: "pending",
						skipReason: undefined,
					});
					countStored(status);
					const saveable =
						canSubmit && (fanOut.links || selectedReadlists.length > 0) && validateSaveableInboxLink(url).status === "SUCCESS";
					if (saveable && status !== "skipped") {
						triagedLinks.push({ ordinal, url, anchorText });
					}
					// Triage verdicts are not deterministic across re-deliveries: a row a
					// previous delivery terminally skipped must never be crawled by a
					// later delivery that judged the same URL an article.
					if (status !== "pending") continue;
					if (cached !== undefined) continue;
					// Submit BEFORE the preview publish: the preview consumer flips this
					// row terminal, so a crash after the preview went out would make the
					// retry's pending-gate skip a submit that never happened.
					if (saveable && fanOut.links) {
						if (!tracksImport) {
							const outputKey = linkOutputKey(ordinal);
							if (!alreadySaved(outputKey)) {
								await submitToAll({ url, emailOutput: { receivedAtMessageId, outputKey } });
							}
						}
						if (routing.kind === "inbox" && !firstInboxNoticePublished) {
							firstInboxNoticePublished = true;
							await publishFirstInboxEmailNotice({
								userId,
								receivedAtMessageId,
								inboxAddress: recipientAddress,
							});
						}
					}
					await publishCrawlPreview({
						userId,
						receivedAtMessageId,
						ordinal,
						url,
					});
				}

				if (held > 0) {
					logger.info(
						"[extract-email-links] saves held for a free account",
						{
							userId,
							receivedAtMessageId,
							held,
						},
					);
				}

				const publishReadlistSelections = async () => {
					if (paidFeatures !== true) return;
					for (const { readlist } of selectedReadlists) {
						await publishEmailLinksTriaged({
							scope: "email",
							...(start > 0 && { startIndex: start }),
							userId,
							receivedAtMessageId,
							readlist,
							senderEmail: email.senderEmail,
							subject: email.subject,
							links: triagedLinks,
						});
					}
				};

				const continues = truncated && !supplemental;
				let selectedOutputs: EmailOutputSelection | undefined;
				const dispatchOutputs = async () => {
					if (!tracksImport) return;
					const waitingForMatches = !supplemental && !fanOut.links && triagedLinks.length > 0 && selectedReadlists.length > 0;
					const page: EmailOutputSelection = {
						outputs: [
							...(start === 0 && fanOut.issue ? [ISSUE_OUTPUT_KEY] : []),
							...(fanOut.links ? triagedLinks.map((link) => linkOutputKey(link.ordinal)) : []),
						],
						truncated: truncated && (!supplemental || fanOut.links),
						selectedAt: now().toISOString(),
						...(continues && { nextLinkIndex: end }),
						...(waitingForMatches && { matches: Object.fromEntries(selectedReadlists.map(({ readlist }) => [emailMatchBatch(readlist, start), null])) }),
					};
					selectedOutputs = frozenSelection ?? (start === 0 ? await selectOutputs({ ...key, ...(supplemental ? { supplemental } : {}), selection: page })
						: await deps.amendSelection({ ...key, change: { kind: "continue", start, page } }));
					for (const outputKey of selectedOutputs.outputs) {
						if (alreadySaved(outputKey)) continue;
						const emailOutput = { receivedAtMessageId, outputKey };
						const ordinal = outputLinkOrdinal(outputKey);
						if (ordinal === undefined) {
							if (start === 0) await saveIssue(emailOutput);
							continue;
						}
						if (!fanOut.links || Number(ordinal) < start || Number(ordinal) >= end) continue;
						const link = await getLink({ userId, receivedAtMessageId, ordinal });
						assert(link, "a selected link's row is written before its selection");
						await submitToAll({ url: link.url, emailOutput });
					}
				};
				if (fanOut.links) await dispatchOutputs();

				if (cached === undefined) await setEmailLinkCounts({
					userId,
					receivedAtMessageId,
					linkCounts: { kept, skipped, truncated },
					...(extractionWindow && { window: extractionWindow }),
				});
				// Write the per-email meta row LAST, after every link row is in place, so
				// its presence is an "extraction finished" barrier: the detail view reads
				// no-meta as "still extracting, keep polling" and meta-present-with-zero-rows
				// as the genuinely terminal "no links found" — never collapsing the two.
				await putLinksMeta({
					userId,
					receivedAtMessageId,
					meta: {
						truncated,
						extractionFailed: false,
						...(extractionWindow && { extractionWindow }),
						...(canSubmit && (fanOut.links || selectedReadlists.length > 0)
							? { selectedReadlists, eligibleArticleCount: triagedLinks.length, savesHeld } : {}),
						...(canSubmit && fanOut.issue
							? { issueSave: { readlists: issueReadlists, held: savesHeld } } : {}),
					},
				});
				// Concurrent deliveries use the winning snapshot even if settings changed mid-run.
				const snapshot = await deps.findLinksMeta(key);
				assert(snapshot, "the extraction snapshot was just persisted");
				if (!supplemental) {
					selectedReadlists = snapshot.selectedReadlists ?? [];
					issueReadlists = snapshot.issueSave?.readlists ?? [];
				}
				if (!fanOut.links) await dispatchOutputs();

				await publishReadlistSelections();
				if (selectedOutputs !== undefined) {
					await publishEmailOutputsSelected({
						userId,
						receivedAtMessageId,
						outputCount: selectedOutputs.outputs.length,
						...(supplemental ? { supplemental } : {}),
					});
				}

				if (continues) {
					await enqueueContinuation({ ...parsed.data, startIndex: end });
					logger.error("[extract-email-links] link cap hit, truncated", {
						receivedAtMessageId,
						found: truncatedLinkCount,
						capped: links.length,
					});
				}
				if (extractionWindow) await deps.markWindowDispatched({ ...key, end });
				logger.info("[extract-email-links] extracted", {
					receivedAtMessageId,
					links: links.length,
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
