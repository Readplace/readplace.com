import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { sendComponent } from "@packages/web-shell";
import {
	EmailLinkOrdinalSchema,
	isLiveAddress,
	isCappedAddress,
	isExcludedLink,
	parseInboxHighlight,
} from "@packages/domain/inbox";
import { newSaveAttemptId } from "@packages/domain/article";
import type { SaveAttemptId, SaveProvenance, SaveTrigger } from "@packages/domain/article";
import {
	DEFAULT_READLIST_SLUG,
	type ReadlistFitOverriddenLogLine,
	type ReadlistSlug,
	ReadlistSlugSchema,
	readlistFitOverrideHost,
} from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type {
	InboxAddressStore,
	InboxEmailLinkEntry,
	InboxEmailLinksMeta,
	InboxEmailLinkStore,
	InboxEmailStore,
	InboxLinkSaveState,
	InboxSavedLinkStore,
} from "@packages/domain/inbox";
import type {
	ContentProvider,
	DeleteReadlistArticleByUrl,
	DeleteReadlistFitOverride,
	FindSavedArticleForLink,
	ListReadlistFitOverrides,
	RecordReadlistFitOverride,
} from "@packages/provider-contracts/article-store";
import type { FileArticleIntoReadlistDetail } from "@packages/infra-components";
import type { Logger } from "@packages/logger";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";
import { emailContentResourceId } from "../../../domain/inbox/email-content-id";
import { validateSaveableInboxLink } from "../../../domain/inbox/saveable-inbox-link";
import { stripUtmParams } from "../../../domain/inbox/strip-utm-params";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { isNonBoostedHtmxRequest } from "../../is-non-boosted-htmx-request";
import { MAX_POLLS, MAX_SAVE_SETTLE_POLLS } from "@packages/web-shell";
import { etagMatches } from "@packages/web-shell";
import { renderInboxArticleCard } from "./inbox-article-card.component";
import { renderInboxArticlesMore } from "./inbox-articles-more.component";
import { parseArticlesShown } from "./inbox-articles-more.url";
import { renderInboxArticlesPanel } from "./inbox-articles-panel.component";
import { renderInboxExcludedLink } from "./inbox-excluded-link.component";
import { computeInboxExcludedRowEtag } from "./inbox-excluded-link.etag";
import {
	INITIAL_SAVE_POLL_COUNT,
	type ExcludedLinkViewModel,
	toInboxExcludedLinkViewModel,
} from "./inbox-excluded-link.viewmodel";
import { renderInboxExcludedPanel } from "./inbox-excluded-panel.component";
import {
	InboxEmailDetailPage,
	renderInboxStatusToast,
} from "./inbox-email-detail.component";
import {
	buildInboxEmailDetailUrl,
	parseInboxEmailFilter,
	parseMailTab,
} from "./inbox-email-detail.url";
import type { InboxEmailPageState, MailTabKey } from "./inbox-email-detail.url";
import {
	buildCardResolvedAnnouncement,
	buildSaveSettledAnnouncement,
	renderInboxLiveStatus,
} from "./inbox-live-status.component";
import { renderInboxMailTabs } from "./inbox-mail-tabs.component";
import {
	fitStatusToast,
	toInboxArticlesMoreViewModel,
	toInboxEmailDetailViewModel,
	toInboxLinkFitViewModel,
} from "./inbox-email-detail.viewmodel";
import type { InboxEmailDetailViewModel } from "./inbox-email-detail.viewmodel";
import { InboxEmailsPage } from "./inbox-emails.component";
import {
	INBOX_EMAILS_PAGE_SIZE,
	buildInboxEmailsUrl,
	parseInboxEmailsUrl,
} from "./inbox-emails.url";
import { toInboxEmailsViewModel } from "./inbox-emails.viewmodel";
import { computeInboxLinkCardEtag } from "./inbox-link-card.etag";
import {
	type InboxLinkCardViewModel,
	toInboxLinkCardViewModel,
} from "./inbox-link-card.viewmodel";
import { parsePollParam } from "@packages/web-shell";
import {
	cardReadlistFits,
	currentReadlistFitOverride,
	type ReadlistFitOverridesByReadlist,
} from "./inbox-readlist-fit";
import { renderInboxReadlistLine } from "./inbox-readlist-line.component";

export interface InboxReadlistFitDependencies {
	findSavedArticleForLink: FindSavedArticleForLink;
	listReadlistFitOverrides: ListReadlistFitOverrides;
	recordReadlistFitOverride: RecordReadlistFitOverride;
	deleteReadlistFitOverride: DeleteReadlistFitOverride;
	deleteReadlistArticleByUrl: DeleteReadlistArticleByUrl;
	publishFileArticleIntoReadlist: (detail: FileArticleIntoReadlistDetail) => Promise<void>;
	fitChoiceLog: Logger.Typed<ReadlistFitOverriddenLogLine>;
}

interface InboxDependencies extends InboxReadlistFitDependencies {
	inboxAddressStore: InboxAddressStore;
	inboxEmailStore: InboxEmailStore;
	inboxEmailLinkStore: InboxEmailLinkStore;
	inboxSavedLinkStore: InboxSavedLinkStore;
	readEmailContent: ContentProvider;
	imagesCdnBaseUrl: string;
	logError: (message: string, error?: Error) => void;
	buildBannerState: BuildBannerState;
	publishSubmitLink: (input: {
		userId: UserId;
		url: string;
		provenance: SaveProvenance;
		readlist: ReadlistSlug;
		saveTrigger: SaveTrigger;
		saveAttemptId: SaveAttemptId;
	}) => Promise<void>;
	recordEngagementActivity: RecordEngagementActivity;
	/** Save gates applied to the write actions — the per-link save (it lands an article
	 * in the reader's queue). Both gates run: `requireNotLocked` blocks a
	 * locked (unverified-past-window) account, `requireWriteAccess` blocks a
	 * read-only (trial-expired / cancelled) account. */
	requireNotLocked: RequestHandler;
	requireWriteAccess: RequestHandler;
	now: () => Date;
}

/** The tabs whose panel is extraction-driven, so each needs a poll fragment. `view`
 * renders the stored email and has nothing to wait for. Typed off `MailTabKey` so a
 * new tab has to decide whether it polls rather than silently not doing so. */
const POLLABLE_PANELS: readonly Exclude<MailTabKey, "view">[] = ["articles", "excluded"];

const POLL_PANEL_RENDERERS: Record<
	Exclude<MailTabKey, "view">,
	(vm: InboxEmailDetailViewModel) => string
> = {
	articles: (vm) => renderInboxArticlesPanel(vm.articles),
	excluded: (vm) => renderInboxExcludedPanel(vm.excluded),
};

function tabForLinkRow(link: InboxEmailLinkEntry): MailTabKey {
	return isExcludedLink(link) ? "excluded" : "articles";
}

function sendInboxArticleCard(
	res: Response,
	input: { vm: InboxLinkCardViewModel; announcement: string },
): void {
	const liveStatusHtml =
		input.announcement === ""
			? ""
			: renderInboxLiveStatus({ message: input.announcement, oob: true });
	res
		.status(200)
		.type("html")
		.send(`${renderInboxArticleCard(input.vm)}${liveStatusHtml}`);
}

function sendInboxExcludedRow(
	res: Response,
	input: { vm: ExcludedLinkViewModel; saveState: InboxLinkSaveState | undefined },
): void {
	const announcement = buildSaveSettledAnnouncement({
		saveState: input.saveState,
		url: input.vm.url,
	});
	const liveStatusHtml =
		announcement === "" ? "" : renderInboxLiveStatus({ message: announcement, oob: true });
	res
		.status(200)
		.type("html")
		.send(`${renderInboxExcludedLink(input.vm)}${liveStatusHtml}`);
}

const LinkFitChoiceSchema = z.object({
	readlist: ReadlistSlugSchema,
	verdict: z.enum(["keep", "drop", "undo"]),
});

const FitConfirmationQuerySchema = z.object({
	fit: z.enum(["keep", "drop"]),
	in: ReadlistSlugSchema,
	link: EmailLinkOrdinalSchema,
});

function withQuery(url: string, params: Record<string, string>): string {
	const query = new URLSearchParams(params).toString();
	return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

const LinkFeedbackSchema = z.object({
	verdict: z.enum(["should-be-included", "should-be-excluded"]),
});

type LinkClassificationVerdict = z.infer<typeof LinkFeedbackSchema>["verdict"];

/** The one classifier-audit line both report paths emit, at ERROR level so a
 * misclassification surfaces in the operator's CloudWatch error widget rather
 * than an unwatched info stream. The article card's "Not an article" button
 * sends `should-be-excluded`; saving a skipped link is itself the reader's
 * `should-be-included` verdict, so the save route emits the same line instead of
 * asking the reader to also press a separate report button. */
function logLinkClassificationFeedback(input: {
	logError: (message: string, error?: Error) => void;
	verdict: LinkClassificationVerdict;
	receivedAtMessageId: string;
	link: InboxEmailLinkEntry;
}): void {
	input.logError(
		`[inbox-link-feedback] ${JSON.stringify({
			verdict: input.verdict,
			receivedAtMessageId: input.receivedAtMessageId,
			ordinal: input.link.ordinal,
			url: input.link.url,
			status: input.link.status,
			skipReason: input.link.skipReason,
		})}`,
	);
}

function parseFitConfirmation(query: unknown) {
	const parsed = FitConfirmationQuerySchema.safeParse(query);
	return parsed.success
		? { verdict: parsed.data.fit, readlist: parsed.data.in, ordinal: parsed.data.link }
		: undefined;
}

export function initInboxRoutes(deps: InboxDependencies): Router {
	const router = express.Router();

	const findLinkSaveStates = async (input: {
		userId: UserId;
		links: readonly InboxEmailLinkEntry[];
	}): Promise<ReadonlyMap<string, InboxLinkSaveState>> =>
		deps.inboxSavedLinkStore.findSavedLinks({
			userId: input.userId,
			urls: input.links.map((link) => link.url),
		});

	const readFitOverrides = async (input: {
		userId: UserId;
		meta: InboxEmailLinksMeta | undefined;
	}): Promise<ReadlistFitOverridesByReadlist> =>
		new Map(
			await Promise.all(
				(input.meta?.selectedReadlists ?? []).map(
					async ({ readlist }) =>
						[
							readlist,
							await deps.listReadlistFitOverrides({ userId: input.userId, readlist }),
						] as const,
				),
			),
		);

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const { cursor } = parseInboxEmailsUrl(req.query);
		const result = await deps.inboxEmailStore.listEmailsByUserId({
			userId,
			cursor,
			pageSize: INBOX_EMAILS_PAGE_SIZE,
		});
		if (cursor !== undefined && result.emails.length === 0) {
			res.redirect(302, buildInboxEmailsUrl({}));
			return;
		}
		const activeAddresses =
			result.emails.length === 0
				? (await deps.inboxAddressStore.listAddressesByUserId(userId))
						.filter((entry) => isLiveAddress(entry) && isCappedAddress(entry))
						.map((entry) => ({ name: entry.name, address: entry.address }))
				: [];
		const vm = toInboxEmailsViewModel(result, {
			now: deps.now(),
			activeAddresses,
			highlight: parseInboxHighlight(req.query),
		});
		sendComponent(req, res, Base(InboxEmailsPage(vm), await deps.buildBannerState(req)));
	});

	// `id` is the URL-encoded `receivedAtMessageId`.
	router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const receivedAtMessageId = req.params.id;
		const entry = await deps.inboxEmailStore.getEmail({
			userId: req.userId,
			receivedAtMessageId,
		});
		if (entry === undefined) {
			res.status(404).type("html").send("");
			return;
		}
		const activeTab = parseMailTab(req.query.tab);
		const bodyHtml =
			activeTab === "view" && entry.status === "received"
				? await deps.readEmailContent(
						emailContentResourceId({ userId: req.userId, receivedAtMessageId }),
					)
				: undefined;
		const linkData =
			activeTab === "view"
				? ({ source: "entry" } as const)
				: {
						source: "rows" as const,
						...(await deps.inboxEmailLinkStore.listLinksByEmail({
							userId: req.userId,
							receivedAtMessageId,
						})),
					};
		const vm = toInboxEmailDetailViewModel({
			entry,
			activeTab,
			bodyHtml,
			imagesCdnBaseUrl: deps.imagesCdnBaseUrl,
			linkData,
			linkSaveStates: await findLinkSaveStates({
				userId: req.userId,
				links: linkData.source === "rows" ? linkData.links : [],
			}),
			maxPolls: MAX_POLLS,
			shown: parseArticlesShown(req.query),
			feedbackConfirmed: req.query.feedback === "sent",
			savedConfirmed: req.query.saved === "1",
			fitConfirmed: parseFitConfirmation(req.query),
			fitOverrides: await readFitOverrides({
				userId: req.userId,
				meta: linkData.source === "rows" ? linkData.meta : undefined,
			}),
			filter: parseInboxEmailFilter(req.query),
		});
		sendComponent(req, res, Base(InboxEmailDetailPage(vm), await deps.buildBannerState(req)));
	});

	// Page-level poll for a panel while extraction is still running. Until the
	// extractor writes the per-email meta barrier there are no link rows to poll, so
	// the panel polls itself here and swaps in its finished state the instant
	// extraction writes its meta. Each panel gets its own literal suffix — which also
	// keeps `/:id` (single segment) from capturing it — because a panel swaps itself
	// via `outerHTML`, so a shared URL would swap the other panel's markup in over it.
	for (const panel of POLLABLE_PANELS) {
		router.get(`/:id/${panel}`, async (req: Request<{ id: string }>, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const receivedAtMessageId = req.params.id;
			const entry = await deps.inboxEmailStore.getEmail({ userId, receivedAtMessageId });
			if (entry === undefined) {
				res.status(404).type("html").send("");
				return;
			}
			const { links, meta } = await deps.inboxEmailLinkStore.listLinksByEmail({
				userId,
				receivedAtMessageId,
			});
			const requestedPoll = parsePollParam(req.query.poll, MAX_POLLS);
			const vm = toInboxEmailDetailViewModel({
				entry,
				activeTab: panel,
				bodyHtml: undefined,
				imagesCdnBaseUrl: deps.imagesCdnBaseUrl,
				linkData: { source: "rows", links, meta },
				linkSaveStates: await findLinkSaveStates({ userId, links }),
				maxPolls: MAX_POLLS,
				panelPollCount: requestedPoll + 1,
				fitOverrides: await readFitOverrides({ userId, meta }),
				filter: parseInboxEmailFilter(req.query),
			});
			// The swap only replaces this one panel, so pair it with an out-of-band
			// swap of the tab strip — otherwise its counts would lag the swapped-in
			// state until a full reload, and this poll is the only request in flight.
			//
			// The tab strip ships ONLY on the tick that has counts to report. Until
			// then it would be byte-identical to the strip already on screen, and an
			// outerHTML swap replaces the tab links rather than editing them: a reader
			// keyboarding through the tabs would lose focus to <body> every few
			// seconds for the whole extraction window.
			const oobTabs = vm.extractionReported
				? renderInboxMailTabs({ tabs: vm.tabs, oob: true })
				: "";
			res.status(200).type("html").send(POLL_PANEL_RENDERERS[panel](vm) + oobTabs);
		});
	}

	router.get("/:id/articles/more", async (req: Request<{ id: string }>, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const receivedAtMessageId = req.params.id;
		const entry = await deps.inboxEmailStore.getEmail({ userId, receivedAtMessageId });
		if (entry === undefined) {
			res.status(404).type("html").send("");
			return;
		}
		const { links, meta } = await deps.inboxEmailLinkStore.listLinksByEmail({
			userId,
			receivedAtMessageId,
		});
		const vm = toInboxArticlesMoreViewModel({
			links,
			meta,
			emailId: receivedAtMessageId,
			shown: parseArticlesShown(req.query),
			maxPolls: MAX_POLLS,
			linkSaveStates: await findLinkSaveStates({ userId, links }),
			fitOverrides: await readFitOverrides({ userId, meta }),
			filter: parseInboxEmailFilter(req.query),
		});
		res.status(200).type("html").send(renderInboxArticlesMore(vm));
	});

	// The literal `links/:ordinal/card` suffix means `/:id` (single segment)
	// never captures it.
	router.get(
		"/:id/links/:ordinal/card",
		async (req: Request<{ id: string; ordinal: string }>, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const receivedAtMessageId = req.params.id;
			const parsedOrdinal = EmailLinkOrdinalSchema.safeParse(req.params.ordinal);
			if (!parsedOrdinal.success) {
				res.status(404).type("html").send("");
				return;
			}
			const { links, meta } = await deps.inboxEmailLinkStore.listLinksByEmail({
				userId,
				receivedAtMessageId,
			});
			const link = links.find((entry) => entry.ordinal === parsedOrdinal.data);
			// A skipped link renders only as the inert excluded row — never as a live
			// card — so the fragment route refuses it like a missing link.
			if (link === undefined || isExcludedLink(link)) {
				res.status(404).type("html").send("");
				return;
			}
			const fit = cardReadlistFits({
				meta,
				fitOverrides: await readFitOverrides({ userId, meta }),
				emailId: receivedAtMessageId,
				ordinal: link.ordinal,
			});
			// Read before the ETag so the save state is part of what the ETag covers;
			// computing it after would let a card that just became saved answer 304
			// with its pre-save validator.
			const linkSaveStates = await findLinkSaveStates({ userId, links: [link] });
			const etag = computeInboxLinkCardEtag({
				link,
				saveState: linkSaveStates.get(link.url),
				fit,
			});
			res.set("Cache-Control", "private, no-cache");
			res.set("Vary", "Cookie");
			res.set("ETag", etag);
			if (etagMatches(req.get("If-None-Match"), etag)) {
				res.status(304).end();
				return;
			}
			const awaitSave = req.query.awaitSave === "1";
			const requestedPoll = parsePollParam(
				req.query.poll,
				awaitSave ? MAX_SAVE_SETTLE_POLLS : MAX_POLLS,
			);
			const cardVm = toInboxLinkCardViewModel({
				link,
				emailId: receivedAtMessageId,
				pollCount: requestedPoll + 1,
				maxPolls: MAX_POLLS,
				shown: parseArticlesShown(req.query),
				filter: parseInboxEmailFilter(req.query),
				fit,
				linkSaveStates,
				savePollContext: awaitSave
					? {
							mode: "save-poll",
							pollCount: requestedPoll + 1,
							maxPolls: MAX_SAVE_SETTLE_POLLS,
						}
					: { mode: "static" },
			});
			sendInboxArticleCard(res, {
				vm: cardVm,
				announcement: awaitSave
					? buildSaveSettledAnnouncement({
							saveState: linkSaveStates.get(link.url),
							url: cardVm.url,
						})
					: buildCardResolvedAnnouncement({
							status: link.status,
							title: cardVm.title,
							url: cardVm.url,
						}),
			});
		},
	);

	router.get(
		"/:id/links/:ordinal/excluded",
		async (req: Request<{ id: string; ordinal: string }>, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const receivedAtMessageId = req.params.id;
			const parsedOrdinal = EmailLinkOrdinalSchema.safeParse(req.params.ordinal);
			const link = parsedOrdinal.success
				? await deps.inboxEmailLinkStore.getLink({
						userId,
						receivedAtMessageId,
						ordinal: parsedOrdinal.data,
					})
				: undefined;
			if (link === undefined || !isExcludedLink(link)) {
				res.status(404).type("html").send("");
				return;
			}
			const linkSaveStates = await findLinkSaveStates({ userId, links: [link] });
			const saveState = linkSaveStates.get(link.url);
			const etag = computeInboxExcludedRowEtag({ link, saveState });
			res.set("Cache-Control", "private, no-cache");
			res.set("Vary", "Cookie");
			res.set("ETag", etag);
			if (etagMatches(req.get("If-None-Match"), etag)) {
				res.status(304).end();
				return;
			}
			const requestedPoll = parsePollParam(req.query.poll, MAX_SAVE_SETTLE_POLLS);
			sendInboxExcludedRow(res, {
				vm: toInboxExcludedLinkViewModel({
					link,
					emailId: receivedAtMessageId,
					linkSaveStates,
					pollContext: {
						mode: "save-poll",
						pollCount: requestedPoll + 1,
						maxPolls: MAX_SAVE_SETTLE_POLLS,
					},
				}),
				saveState,
			});
		},
	);

	router.post(
		"/:id/links/:ordinal/feedback",
		async (req: Request<{ id: string; ordinal: string }>, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const receivedAtMessageId = req.params.id;
			const parsedOrdinal = EmailLinkOrdinalSchema.safeParse(req.params.ordinal);
			const link = parsedOrdinal.success
				? await deps.inboxEmailLinkStore.getLink({
						userId,
						receivedAtMessageId,
						ordinal: parsedOrdinal.data,
					})
				: undefined;
			if (link === undefined) {
				res.status(404).type("html").send("");
				return;
			}
			const parsedBody = LinkFeedbackSchema.safeParse(req.body);
			if (parsedBody.success) {
				logLinkClassificationFeedback({
					logError: deps.logError,
					verdict: parsedBody.data.verdict,
					receivedAtMessageId,
					link,
				});
			}
			// Back to the tab the reported row lives on, keyed off its status rather
			// than the verdict: a card reported from Articles returns to Articles. A
			// fixed tab would bounce the reader to a panel that doesn't hold it.
			const tab = tabForLinkRow(link);
			res.redirect(
				303,
				`${buildInboxEmailDetailUrl({
					emailId: receivedAtMessageId,
					tab,
					shown: parseArticlesShown(req.body),
					filter: parseInboxEmailFilter(req.body),
				})}&feedback=sent`,
			);
		},
	);

	router.post(
		"/:id/links/:ordinal/save",
		deps.requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request<{ id: string; ordinal: string }>, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const receivedAtMessageId = req.params.id;
			const parsedOrdinal = EmailLinkOrdinalSchema.safeParse(req.params.ordinal);
			const link = parsedOrdinal.success
				? await deps.inboxEmailLinkStore.getLink({
						userId,
						receivedAtMessageId,
						ordinal: parsedOrdinal.data,
					})
				: undefined;
			if (link === undefined || validateSaveableInboxLink(link.url).status !== "SUCCESS") {
				res.status(404).type("html").send("");
				return;
			}
			// A retried save re-enters the not-yet-saved world: dropping the recorded
			// failure is what lets this attempt's own outcome land as the row's only
			// claim, instead of a stale refusal outliving the click that answered it.
			const priorSaveStates = await findLinkSaveStates({ userId, links: [link] });
			if (priorSaveStates.get(link.url) === "failed") {
				await deps.inboxSavedLinkStore.retractLinkSaved({ userId, url: link.url });
			}
			// Submits the stored URL, never the resolved one — the save pipeline owns
			// redirects. Stripping runs after the saveable gate above and only shortens,
			// so the validated URL cannot grow back past its length cap.
			const unresolved = link.status === "pending" || link.status === "skipped";
			const email = await deps.inboxEmailStore.getEmail({ userId, receivedAtMessageId });
			assert(email, "the email a saved link belongs to must still exist");
			await deps.publishSubmitLink({
				userId,
				url: unresolved ? link.url : stripUtmParams(link.url),
				provenance: { kind: "email", senderEmail: email.senderEmail },
				readlist: DEFAULT_READLIST_SLUG,
				saveTrigger: "manual",
				saveAttemptId: newSaveAttemptId(),
			});
			await deps.recordEngagementActivity({ userId, kind: "personal-save", at: deps.now() });
			// Saving a skipped link is itself the reader's verdict that the classifier
			// was wrong to skip it, so it emits the same classifier-audit line the
			// removed "This is an article" report button did — Save both remediates and
			// reports. A kept card's save carries no such verdict, so it stays silent.
			if (link.status === "skipped") {
				logLinkClassificationFeedback({
					logError: deps.logError,
					verdict: "should-be-included",
					receivedAtMessageId,
					link,
				});
			}
			if (isNonBoostedHtmxRequest(req)) {
				const linkSaveStates = await findLinkSaveStates({ userId, links: [link] });
				if (isExcludedLink(link)) {
					sendInboxExcludedRow(res, {
						vm: toInboxExcludedLinkViewModel({
							link,
							emailId: receivedAtMessageId,
							linkSaveStates,
							pollContext: {
								mode: "save-poll",
								pollCount: INITIAL_SAVE_POLL_COUNT,
								maxPolls: MAX_SAVE_SETTLE_POLLS,
							},
						}),
						saveState: linkSaveStates.get(link.url),
					});
					return;
				}
				const { meta } = await deps.inboxEmailLinkStore.listLinksByEmail({
					userId,
					receivedAtMessageId,
				});
				const cardVm = toInboxLinkCardViewModel({
					link,
					emailId: receivedAtMessageId,
					pollCount: INITIAL_SAVE_POLL_COUNT,
					maxPolls: MAX_POLLS,
					shown: parseArticlesShown(req.body),
					filter: parseInboxEmailFilter(req.body),
					fit: cardReadlistFits({
						meta,
						fitOverrides: await readFitOverrides({ userId, meta }),
						emailId: receivedAtMessageId,
						ordinal: link.ordinal,
					}),
					linkSaveStates,
					savePollContext: {
						mode: "save-poll",
						pollCount: INITIAL_SAVE_POLL_COUNT,
						maxPolls: MAX_SAVE_SETTLE_POLLS,
					},
				});
				sendInboxArticleCard(res, {
					vm: cardVm,
					announcement: buildSaveSettledAnnouncement({
						saveState: linkSaveStates.get(link.url),
						url: cardVm.url,
					}),
				});
				return;
			}
			res.redirect(
				303,
				`${buildInboxEmailDetailUrl({
					emailId: receivedAtMessageId,
					tab: tabForLinkRow(link),
					shown: parseArticlesShown(req.body),
					filter: parseInboxEmailFilter(req.body),
				})}&saved=1`,
			);
		},
	);

	router.post(
		"/:id/links/:ordinal/fit",
		deps.requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request<{ id: string; ordinal: string }>, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const receivedAtMessageId = req.params.id;
			const notFound = () => res.status(404).type("html").send("");
			const parsedOrdinal = EmailLinkOrdinalSchema.safeParse(req.params.ordinal);
			if (!parsedOrdinal.success) return notFound();
			const ordinal = parsedOrdinal.data;
			const { links, meta } = await deps.inboxEmailLinkStore.listLinksByEmail({
				userId,
				receivedAtMessageId,
			});
			const link = links.find((entry) => entry.ordinal === ordinal);
			if (
				link === undefined ||
				isExcludedLink(link) ||
				validateSaveableInboxLink(link.url).status !== "SUCCESS"
			) {
				return notFound();
			}
			const email = await deps.inboxEmailStore.getEmail({ userId, receivedAtMessageId });
			if (email === undefined) return notFound();
			const parsedBody = LinkFitChoiceSchema.safeParse(req.body);
			if (!parsedBody.success) return notFound();
			const { readlist, verdict } = parsedBody.data;
			const routed = meta?.selectedReadlists?.find((entry) => entry.readlist === readlist);
			const outcome = meta?.readlistOutcomes?.find((entry) => entry.readlist === readlist);
			const engineFit = outcome?.fit.find((entry) => entry.ordinal === ordinal);
			if (
				meta?.savesHeld === true ||
				routed === undefined ||
				outcome === undefined ||
				(outcome.decision !== "filtered" && outcome.decision !== "failed") ||
				(outcome.decision === "filtered" && engineFit === undefined)
			) {
				return notFound();
			}
			const current = currentReadlistFitOverride({
				overrides: await deps.listReadlistFitOverrides({ userId, readlist }),
				emailId: receivedAtMessageId,
				ordinal,
			});
			if (verdict === "undo" && current === undefined) return notFound();
			const saved = await deps.findSavedArticleForLink({ userId, url: link.url });
			const provenance = { kind: "email", senderEmail: email.senderEmail };
			const removeFromReadlist = async () => {
				if (saved.kind === "saved") {
					await deps.deleteReadlistArticleByUrl({ userId, readlist, url: saved.resolvedUrl });
				}
			};
			if (verdict === "undo") {
				assert(current, "an undo reverses the reader's current choice");
				if (current.engineVerdict === "keep") {
					assert(current.engineReason, "an engine keep carries its reason");
					assert(current.purposeVersion, "an engine keep carries its purpose version");
					await deps.publishFileArticleIntoReadlist({
						userId,
						url: link.url,
						readlist,
						provenance,
						fit: {
							verdict: "keep",
							reason: current.engineReason,
							purposeVersion: current.purposeVersion,
							source: { kind: "email", receivedAtMessageId, ordinal },
						},
					});
				} else {
					await removeFromReadlist();
				}
				await deps.deleteReadlistFitOverride({ userId, readlist, id: current.id });
			} else {
				if (verdict === "keep") {
					await deps.publishFileArticleIntoReadlist({
						userId,
						url: link.url,
						readlist,
						provenance,
						fit: {
							verdict: "keep",
							purposeVersion:
								outcome.decision === "filtered" ? outcome.purposeVersion : undefined,
							source: { kind: "reader" },
						},
					});
				} else {
					await removeFromReadlist();
				}
				if (current !== undefined) {
					await deps.deleteReadlistFitOverride({ userId, readlist, id: current.id });
				}
				await deps.recordReadlistFitOverride({
					userId,
					readlist,
					override: {
						url: saved.resolvedUrl,
						anchorText: link.anchorText ?? "",
						host: readlistFitOverrideHost(saved.resolvedUrl),
						engineVerdict: engineFit?.verdict,
						engineReason: engineFit?.reason,
						readerVerdict: verdict,
						purposeVersion: outcome.purposeVersion,
						receivedAtMessageId,
						ordinal,
						createdAt: deps.now(),
					},
				});
			}
			deps.fitChoiceLog.info({
				level: "INFO",
				event: "readlist-fit-overridden",
				userId,
				readlist,
				receivedAtMessageId,
				ordinal,
				engineVerdict: engineFit?.verdict,
				readerVerdict: verdict,
			});
			const pageState: InboxEmailPageState = {
				tab: parseMailTab(req.query.tab),
				shown: parseArticlesShown(req.query),
				filter: parseInboxEmailFilter(req.query),
			};
			if (isNonBoostedHtmxRequest(req)) {
				const fitView = toInboxLinkFitViewModel({
					links,
					meta,
					link,
					emailId: receivedAtMessageId,
					readlist,
					shown: parseArticlesShown(req.query),
					filter: pageState.filter,
					maxPolls: MAX_POLLS,
					linkSaveStates: await findLinkSaveStates({ userId, links: [link] }),
					fitOverrides: await readFitOverrides({ userId, meta }),
				});
				const cardHtml = fitView.card === undefined ? "" : renderInboxArticleCard(fitView.card);
				const lineHtml = renderInboxReadlistLine(fitView.line).replace(
					"<div ",
					'<div hx-swap-oob="outerHTML" ',
				);
				const toastHtml =
					verdict === "undo"
						? ""
						: `<div id="status-toast" class="inbox-email-detail__toast-mount" hx-swap-oob="outerHTML">${renderInboxStatusToast(
								fitStatusToast({
									emailId: receivedAtMessageId,
									pageState,
									confirmation: { verdict, readlist, ordinal },
									label: routed.label,
								}),
							)}</div>`;
				res.status(200).type("html").send(`${cardHtml}${lineHtml}${toastHtml}`);
				return;
			}
			const detailUrl = buildInboxEmailDetailUrl({ emailId: receivedAtMessageId, ...pageState });
			res.redirect(
				303,
				verdict === "undo"
					? detailUrl
					: withQuery(detailUrl, { fit: verdict, in: readlist, link: ordinal }),
			);
		},
	);

	return router;
}
