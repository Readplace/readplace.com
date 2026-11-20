import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { sendComponent } from "@packages/web-shell";
import {
	type EmailLinkOrdinal,
	EmailLinkOrdinalSchema,
	isLiveAddress,
	isCappedAddress,
	isExcludedLink,
	parseInboxHighlight,
} from "@packages/domain/inbox";
import { newSaveAttemptId, wrapperFamilyOf } from "@packages/domain/article";
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
	InboxEmailEntry,
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
	ListUserSavesForUrl,
	RecordReadlistFitOverride,
} from "@packages/provider-contracts/article-store";
import type { PublishLinkDequeued } from "@packages/provider-contracts/events";
import type { FileArticleIntoReadlistDetail } from "@packages/infra-components";
import type { Logger, LogError } from "@packages/logger";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";
import { emailContentResourceId } from "../../../domain/inbox/email-content-id";
import { TRIAGED_ANCHOR_TEXT_MAX_CHARS } from "../../../domain/inbox/extract-email-links-handler";
import type { FindSavedTrackerDestination } from "../../../domain/inbox/find-saved-tracker-destination";
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
import {
	buildSavedAsArticleAnnouncement,
	renderInboxExcludedLinkMoved,
} from "./inbox-excluded-link-moved.component";
import { toInboxExcludedLinkUrl } from "./inbox-excluded-link.viewmodel";
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
import { buildMailTabs } from "./mail-tabs";
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
	listUserSavesForUrl: ListUserSavesForUrl;
	publishLinkDequeued: PublishLinkDequeued;
	publishFileArticleIntoReadlist: (detail: FileArticleIntoReadlistDetail) => Promise<void>;
	fitChoiceLog: Logger.Typed<ReadlistFitOverriddenLogLine>;
}

interface InboxDependencies extends InboxReadlistFitDependencies {
	inboxAddressStore: InboxAddressStore;
	inboxEmailStore: InboxEmailStore;
	inboxEmailLinkStore: InboxEmailLinkStore;
	inboxSavedLinkStore: InboxSavedLinkStore;
	readEmailContent: ContentProvider;
	findSavedTrackerDestination: FindSavedTrackerDestination;
	imagesCdnBaseUrl: string;
	logError: LogError;
	buildBannerState: BuildBannerState;
	publishSubmitLink: (input: {
		userId: UserId;
		url: string;
		provenance: SaveProvenance;
		readlist: ReadlistSlug;
		saveTrigger: SaveTrigger;
		saveAttemptId: SaveAttemptId;
	}) => Promise<void>;
	publishCrawlPreview: (input: {
		userId: UserId;
		receivedAtMessageId: string;
		ordinal: EmailLinkOrdinal;
		url: string;
	}) => Promise<void>;
	publishSavedLinkTriaged: (input: {
		scope: "link";
		userId: UserId;
		receivedAtMessageId: string;
		readlist: ReadlistSlug;
		senderEmail: string;
		subject: string;
		links: [{ ordinal: EmailLinkOrdinal; url: string; anchorText: string }];
	}) => Promise<void>;
	recordEngagementActivity: RecordEngagementActivity;
	requireNotLocked: RequestHandler;
	requirePaidFeatures: RequestHandler;
	now: () => Date;
}

/** The tabs whose panel is extraction-driven, so each needs a poll fragment. `view`
 * renders the stored email and has nothing to wait for. Typed off `MailTabKey` so a
 * new tab has to decide whether it polls rather than silently not doing so. */
const INITIAL_SAVE_POLL_COUNT = 1;

const POLLABLE_PANELS: readonly Exclude<MailTabKey, "view">[] = ["articles", "excluded"];

const POLL_PANEL_RENDERERS: Record<
	Exclude<MailTabKey, "view">,
	(vm: InboxEmailDetailViewModel) => string
> = {
	articles: (vm) => renderInboxArticlesPanel(vm.articles),
	excluded: (vm) => renderInboxExcludedPanel(vm.excluded),
};

function submittedLinkUrl(link: InboxEmailLinkEntry): string {
	const unresolved = link.status === "pending" || link.status === "skipped";
	return unresolved ? link.url : stripUtmParams(link.url);
}

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
	logError: LogError;
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

	const findSavedDestinations = async (input: {
		links: readonly InboxEmailLinkEntry[];
		linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
	}): Promise<ReadonlyMap<string, string>> => {
		const lookups = input.links.filter(
			(link) =>
				input.linkSaveStates.get(link.url) === "saved" &&
				(link.resolvedUrl === undefined || link.status === "failed") &&
				wrapperFamilyOf(link.url) === "newsletter-tracker",
		);
		const found = await Promise.all(
			lookups.map(async (link) => {
				const destination = await deps.findSavedTrackerDestination(link.url);
				return destination === undefined ? [] : [[link.url, destination] as const];
			}),
		);
		return new Map(found.flat());
	};

	const findLinkSaves = async (input: {
		userId: UserId;
		links: readonly InboxEmailLinkEntry[];
	}): Promise<{
		linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
		savedDestinations: ReadonlyMap<string, string>;
	}> => {
		const linkSaveStates = await findLinkSaveStates(input);
		return { linkSaveStates, savedDestinations: await findSavedDestinations({ links: input.links, linkSaveStates }) };
	};

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

	const moveSkippedLinkToArticles = async (input: {
		userId: UserId;
		receivedAtMessageId: string;
		link: InboxEmailLinkEntry;
		email: InboxEmailEntry;
	}): Promise<void> => {
		const { userId, receivedAtMessageId, link, email } = input;
		const rescue = await deps.inboxEmailLinkStore.rescueSkippedLink({
			userId,
			receivedAtMessageId,
			ordinal: link.ordinal,
		});
		if (rescue === "not-skipped") return;
		await deps.publishCrawlPreview({ userId, receivedAtMessageId, ordinal: link.ordinal, url: link.url });
		await deps.inboxEmailStore.moveLinkCountToKept({ userId, receivedAtMessageId });
		const { meta } = await deps.inboxEmailLinkStore.listLinksByEmail({ userId, receivedAtMessageId });
		assert(meta, "a skipped link's email has finished extraction");
		if (meta.selectedReadlists === undefined) return;
		await deps.inboxEmailLinkStore.addEligibleArticle({ userId, receivedAtMessageId });
		if (meta.savesHeld === true) return;
		for (const { readlist } of meta.selectedReadlists) {
			await deps.publishSavedLinkTriaged({
				scope: "link",
				userId,
				receivedAtMessageId,
				readlist,
				senderEmail: email.senderEmail,
				subject: email.subject,
				links: [
					{
						ordinal: link.ordinal,
						url: link.url,
						anchorText: (link.anchorText ?? "").slice(0, TRIAGED_ANCHOR_TEXT_MAX_CHARS),
					},
				],
			});
		}
	};

	const sendSkippedLinkMoved = async (
		res: Response,
		input: { userId: UserId; receivedAtMessageId: string; link: InboxEmailLinkEntry; articlesHref: string },
	): Promise<void> => {
		const { links } = await deps.inboxEmailLinkStore.listLinksByEmail({
			userId: input.userId,
			receivedAtMessageId: input.receivedAtMessageId,
		});
		const excluded = links.filter(isExcludedLink).length;
		const url = toInboxExcludedLinkUrl(input.link);
		const tabs = buildMailTabs({
			emailId: input.receivedAtMessageId,
			active: "excluded",
			counts: { articles: links.length - excluded, excluded },
		});
		res
			.status(200)
			.type("html")
			.send(
				`${renderInboxExcludedLinkMoved({
					ordinal: input.link.ordinal,
					url,
					articlesHref: input.articlesHref,
				})}${renderInboxMailTabs({ tabs, oob: true })}${renderInboxLiveStatus({
					message: buildSavedAsArticleAnnouncement({ url }),
					oob: true,
				})}`,
			);
	};

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
		const bannerState = await deps.buildBannerState(req);
		const vm = toInboxEmailsViewModel(result, {
			now: deps.now(),
			activeAddresses,
			paidFeaturesLocked: bannerState.paidFeaturesLocked === true,
			highlight: parseInboxHighlight(req.query),
		});
		sendComponent(req, res, Base(InboxEmailsPage(vm), bannerState));
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
		const bannerState = await deps.buildBannerState(req);
		const vm = toInboxEmailDetailViewModel({
			entry,
			activeTab,
			bodyHtml,
			imagesCdnBaseUrl: deps.imagesCdnBaseUrl,
			linkData,
			...(await findLinkSaves({
				userId: req.userId,
				links: linkData.source === "rows" ? linkData.links : [],
			})),
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
			paidFeaturesLocked: bannerState.paidFeaturesLocked === true,
		});
		sendComponent(req, res, Base(InboxEmailDetailPage(vm), bannerState));
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
				...(await findLinkSaves({ userId, links })),
				maxPolls: MAX_POLLS,
				panelPollCount: requestedPoll + 1,
				fitOverrides: await readFitOverrides({ userId, meta }),
				filter: parseInboxEmailFilter(req.query),
				paidFeaturesLocked: (await deps.buildBannerState(req)).paidFeaturesLocked === true,
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
			...(await findLinkSaves({ userId, links })),
			fitOverrides: await readFitOverrides({ userId, meta }),
			filter: parseInboxEmailFilter(req.query),
			paidFeaturesLocked: (await deps.buildBannerState(req)).paidFeaturesLocked === true,
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
			const { linkSaveStates, savedDestinations } = await findLinkSaves({ userId, links: [link] });
			const etag = computeInboxLinkCardEtag({
				link,
				saveState: linkSaveStates.get(link.url),
				savedDestination: savedDestinations.get(link.url),
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
				savedDestinations,
				savePollContext: awaitSave
					? {
							mode: "save-poll",
							pollCount: requestedPoll + 1,
							maxPolls: MAX_SAVE_SETTLE_POLLS,
						}
					: { mode: "static" },
				paidFeaturesLocked: (await deps.buildBannerState(req)).paidFeaturesLocked === true,
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
		deps.requirePaidFeatures,
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
			const email = await deps.inboxEmailStore.getEmail({ userId, receivedAtMessageId });
			assert(email, "the email a saved link belongs to must still exist");
			await deps.publishSubmitLink({
				userId,
				url: submittedLinkUrl(link),
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
			if (isExcludedLink(link)) {
				logLinkClassificationFeedback({
					logError: deps.logError,
					verdict: "should-be-included",
					receivedAtMessageId,
					link,
				});
				await moveSkippedLinkToArticles({ userId, receivedAtMessageId, link, email });
				const articlesHref = buildInboxEmailDetailUrl({
					emailId: receivedAtMessageId,
					tab: "articles",
					shown: parseArticlesShown(req.body),
					filter: parseInboxEmailFilter(req.body),
				});
				if (isNonBoostedHtmxRequest(req)) {
					await sendSkippedLinkMoved(res, { userId, receivedAtMessageId, link, articlesHref });
					return;
				}
				res.redirect(303, `${articlesHref}&saved=1`);
				return;
			}
			if (isNonBoostedHtmxRequest(req)) {
				const { linkSaveStates, savedDestinations } = await findLinkSaves({ userId, links: [link] });
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
					savedDestinations,
					savePollContext: {
						mode: "save-poll",
						pollCount: INITIAL_SAVE_POLL_COUNT,
						maxPolls: MAX_SAVE_SETTLE_POLLS,
					},
					paidFeaturesLocked: false,
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
					tab: "articles",
					shown: parseArticlesShown(req.body),
					filter: parseInboxEmailFilter(req.body),
				})}&saved=1`,
			);
		},
	);

	router.post(
		"/:id/links/:ordinal/fit",
		deps.requireNotLocked,
		deps.requirePaidFeatures,
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
			const provenance = { kind: "email" as const, senderEmail: email.senderEmail };
			const removeFromReadlist = async () => {
				await deps.deleteReadlistArticleByUrl({ userId, readlist, url: saved.resolvedUrl });
				const remaining = await deps.listUserSavesForUrl({ userId, url: saved.resolvedUrl });
				if (remaining.length > 0) return;
				await deps.inboxSavedLinkStore.retractLinkSaved({ userId, url: link.url });
				await deps.publishLinkDequeued({ userId, url: saved.resolvedUrl });
			};
			let savedToAll = false;
			const fileIntoReadlist = async (fit: FileArticleIntoReadlistDetail["fit"]) => {
				if (saved.kind === "not-saved") {
					savedToAll = true;
					await deps.publishSubmitLink({
						userId,
						url: submittedLinkUrl(link),
						provenance,
						readlist: DEFAULT_READLIST_SLUG,
						saveTrigger: "manual",
						saveAttemptId: newSaveAttemptId(),
					});
				}
				await deps.publishFileArticleIntoReadlist({ userId, url: link.url, readlist, provenance, fit });
			};
			if (verdict === "undo") {
				assert(current, "an undo reverses the reader's current choice");
				const engineVerdict = current.engineVerdict ?? engineFit?.verdict;
				const engineReason = current.engineReason ?? engineFit?.reason;
				const purposeVersion = current.purposeVersion ?? outcome.purposeVersion;
				if (engineVerdict === "keep") {
					assert(engineReason, "an engine keep carries its reason");
					assert(purposeVersion, "an engine keep carries its purpose version");
					await fileIntoReadlist({
						verdict: "keep",
						reason: engineReason,
						purposeVersion,
						source: { kind: "email", receivedAtMessageId, ordinal },
					});
				} else {
					await removeFromReadlist();
				}
				await deps.deleteReadlistFitOverride({ userId, readlist, id: current.id });
			} else {
				if (verdict === "keep") {
					await fileIntoReadlist({
						verdict: "keep",
						purposeVersion: outcome.decision === "filtered" ? outcome.purposeVersion : undefined,
						source: { kind: "reader" },
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
					...(await findLinkSaves({ userId, links: [link] })),
					fitOverrides: await readFitOverrides({ userId, meta }),
					savePollContext: savedToAll
						? { mode: "save-poll", pollCount: INITIAL_SAVE_POLL_COUNT, maxPolls: MAX_SAVE_SETTLE_POLLS }
						: { mode: "static" },
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
