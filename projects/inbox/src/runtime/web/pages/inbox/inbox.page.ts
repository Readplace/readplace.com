import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { sendComponent } from "@packages/web-shell";
import {
	AliasNameSchema,
	countLiveUserAliases,
	DEFAULT_INBOX_ADDRESS_PURPOSE,
	EmailLinkOrdinalSchema,
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
	InboxAddressSchema,
	isLiveAddress,
	isUserAlias,
	normalizeAliasName,
	userAliasCapReached,
	INBOX_ADDRESSES_PATH,
	parseInboxHighlight,
} from "@packages/domain/inbox";
import { validateSaveableUrl } from "@packages/domain/article";
import type { SaveProvenance } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type {
	EmailLinkStatus,
	InboxAddressStore,
	InboxEmailLinkEntry,
	InboxEmailLinkStore,
	InboxEmailStore,
	InboxLinkSaveState,
	InboxSavedLinkStore,
} from "@packages/domain/inbox";
import type { ContentProvider } from "@packages/provider-contracts/article-store";
import { emailContentResourceId } from "../../../domain/inbox/email-content-id";
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
import { InboxEmailDetailPage } from "./inbox-email-detail.component";
import { buildInboxEmailDetailUrl, parseMailTab } from "./inbox-email-detail.url";
import type { MailTabKey } from "./inbox-email-detail.url";
import {
	buildCardResolvedAnnouncement,
	buildSaveSettledAnnouncement,
	renderInboxLiveStatus,
} from "./inbox-live-status.component";
import { renderInboxMailTabs } from "./inbox-mail-tabs.component";
import {
	toInboxArticlesMoreViewModel,
	toInboxEmailDetailViewModel,
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
import { InboxPage } from "./inbox.component";

interface InboxDependencies {
	inboxAddressStore: InboxAddressStore;
	inboxEmailStore: InboxEmailStore;
	inboxEmailLinkStore: InboxEmailLinkStore;
	inboxSavedLinkStore: InboxSavedLinkStore;
	readEmailContent: ContentProvider;
	inboxAddressDomain: string;
	imagesCdnBaseUrl: string;
	logError: (message: string, error?: Error) => void;
	buildBannerState: BuildBannerState;
	publishSubmitLink: (input: {
		userId: UserId;
		url: string;
		provenance: SaveProvenance;
	}) => Promise<void>;
	/** Save gates applied to the write actions — /create and /enable (each opens
	 * a mail-receiving save-flow input) and the per-link save (it lands an article
	 * in the reader's queue). Both gates run: `requireNotLocked` blocks a
	 * locked (unverified-past-window) account, `requireWriteAccess` blocks a
	 * read-only (trial-expired / cancelled) account. Viewing and disabling existing
	 * addresses stay open — disabling reduces footprint and is harmless. */
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

function tabForLinkRow(status: EmailLinkStatus): MailTabKey {
	return status === "skipped" ? "excluded" : "articles";
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

const AddressActionSchema = z.object({ address: InboxAddressSchema });
const CreateAddressSchema = z.object({ name: z.string() });
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

export function initInboxRoutes(deps: InboxDependencies): Router {
	const router = express.Router();
	const addressesPath = INBOX_ADDRESSES_PATH;
	const addressesCreateFailedPath = `${addressesPath}?error=create`;

	const findLinkSaveStates = async (input: {
		userId: UserId;
		links: readonly InboxEmailLinkEntry[];
	}): Promise<ReadonlyMap<string, InboxLinkSaveState>> =>
		deps.inboxSavedLinkStore.findSavedLinks({
			userId: input.userId,
			urls: input.links.map((link) => link.url),
		});

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
						.filter(isLiveAddress)
						.map((entry) => ({ name: entry.name, address: entry.address }))
				: [];
		const vm = toInboxEmailsViewModel(result, {
			now: deps.now(),
			activeAddresses,
			highlight: parseInboxHighlight(req.query),
		});
		sendComponent(req, res, Base(InboxEmailsPage(vm), await deps.buildBannerState(req)));
	});

	router.get("/addresses", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const addresses = await deps.inboxAddressStore.listAddressesByUserId(req.userId);
		const createFailed = req.query.error === "create";
		const nameInvalid = req.query.error === "name";
		const nameTaken = req.query.error === "name-taken";
		const createdName = AliasNameSchema.safeParse(req.query.created);
		// Banner shows whenever the cap is genuinely reached, not only after a
		// rejected create. error=limit stays OR'd in so a just-rejected create
		// still shows it even when the eventually-consistent live read
		// (listAddressesByUserId) briefly undercounts and would otherwise drop it.
		const limitReached =
			req.query.error === "limit" || countLiveUserAliases(addresses) >= INBOX_ADDRESS_MAX_PER_USER;
		const submittedName = typeof req.query.name === "string" ? req.query.name : "";
		sendComponent(
			req,
			res,
			Base(
				InboxPage({
					addresses,
					createFailed,
					nameInvalid,
					nameTaken,
					limitReached,
					createdName: createdName.success ? createdName.data : undefined,
					submittedName,
				}),
				await deps.buildBannerState(req),
			),
		);
	});

	// Registered after the literal `/addresses` route so that path is never
	// captured as an email id. `id` is the URL-encoded `receivedAtMessageId`.
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
		const { links } = await deps.inboxEmailLinkStore.listLinksByEmail({
			userId,
			receivedAtMessageId,
		});
		const vm = toInboxArticlesMoreViewModel({
			links,
			emailId: receivedAtMessageId,
			shown: parseArticlesShown(req.query),
			maxPolls: MAX_POLLS,
			linkSaveStates: await findLinkSaveStates({ userId, links }),
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
			const link = parsedOrdinal.success
				? await deps.inboxEmailLinkStore.getLink({
						userId,
						receivedAtMessageId,
						ordinal: parsedOrdinal.data,
					})
				: undefined;
			// A skipped link renders only as the inert excluded row — never as a live
			// card — so the fragment route refuses it like a missing link.
			if (link === undefined || link.status === "skipped") {
				res.status(404).type("html").send("");
				return;
			}
			// Read before the ETag so the save state is part of what the ETag covers;
			// computing it after would let a card that just became saved answer 304
			// with its pre-save validator.
			const linkSaveStates = await findLinkSaveStates({ userId, links: [link] });
			const etag = computeInboxLinkCardEtag({
				link,
				saveState: linkSaveStates.get(link.url),
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
			if (link === undefined || link.status !== "skipped") {
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
			const tab = tabForLinkRow(link.status);
			res.redirect(
				303,
				`${buildInboxEmailDetailUrl({
					emailId: receivedAtMessageId,
					tab,
					shown: parseArticlesShown(req.body),
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
			if (link === undefined || validateSaveableUrl(link.url).status !== "SUCCESS") {
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
			});
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
				if (link.status === "skipped") {
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
				const cardVm = toInboxLinkCardViewModel({
					link,
					emailId: receivedAtMessageId,
					pollCount: INITIAL_SAVE_POLL_COUNT,
					maxPolls: MAX_POLLS,
					shown: parseArticlesShown(req.body),
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
					tab: tabForLinkRow(link.status),
					shown: parseArticlesShown(req.body),
				})}&saved=1`,
			);
		},
	);

	router.post("/create", deps.requireNotLocked, deps.requireWriteAccess, async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsed = CreateAddressSchema.safeParse(req.body);
		const name = parsed.success ? normalizeAliasName(parsed.data.name) : undefined;
		if (name === undefined) {
			res.redirect(303, `${addressesPath}?error=name`);
			return;
		}
		// Soft duplicate guard: reject a name the user already holds on a live
		// address so two of their newsletters don't share a label. Best-effort like
		// the per-user cap — the eventually-consistent list read can miss a
		// just-minted row — so a rare racing pair may both land; harmless, since the
		// random token still keeps the two addresses distinct.
		const owned = await deps.inboxAddressStore.listAddressesByUserId(userId);
		if (owned.some((entry) => isLiveAddress(entry) && entry.name === name)) {
			res.redirect(303, `${addressesPath}?error=name-taken&name=${encodeURIComponent(name)}`);
			return;
		}
		try {
			await deps.inboxAddressStore.createAddress({
				userId,
				domain: deps.inboxAddressDomain,
				name,
				purpose: DEFAULT_INBOX_ADDRESS_PURPOSE,
			});
		} catch (error) {
			// Hitting the per-user cap is expected user behaviour, not a fault — echo
			// it back as a friendly message instead of logging an alerting-worthy error.
			if (error instanceof InboxAddressLimitReachedError) {
				res.redirect(303, `${addressesPath}?error=limit&name=${encodeURIComponent(name)}`);
				return;
			}
			deps.logError(
				"[Inbox] Failed to create a forwarding address",
				error instanceof Error ? error : new Error(String(error)),
			);
			res.redirect(303, `${addressesCreateFailedPath}&name=${encodeURIComponent(name)}`);
			return;
		}
		res.redirect(303, `${addressesPath}?created=${encodeURIComponent(name)}`);
	});

	router.post("/disable", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsed = AddressActionSchema.safeParse(req.body);
		if (parsed.success) {
			// Confirm ownership before disabling so a forged address for someone
			// else's row never reaches the (also ownership-guarded) store write.
			const owned = await deps.inboxAddressStore.listAddressesByUserId(userId);
			const target = owned.find((entry) => entry.address === parsed.data.address);
			if (target !== undefined && isUserAlias(target)) {
				await deps.inboxAddressStore.disableAddress({ userId, address: parsed.data.address });
			}
		}
		res.redirect(303, addressesPath);
	});

	router.post(
		"/enable",
		deps.requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const parsed = AddressActionSchema.safeParse(req.body);
			if (parsed.success) {
				const owned = await deps.inboxAddressStore.listAddressesByUserId(userId);
				const target = owned.find((entry) => entry.address === parsed.data.address);
				if (target !== undefined && isUserAlias(target) && !isLiveAddress(target)) {
					if (userAliasCapReached({ purpose: target.purpose, owned })) {
						res.redirect(303, `${addressesPath}?error=limit`);
						return;
					}
					await deps.inboxAddressStore.enableAddress({ userId, address: parsed.data.address });
				}
			}
			res.redirect(303, addressesPath);
		},
	);

	return router;
}
