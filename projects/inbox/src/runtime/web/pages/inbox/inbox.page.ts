import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { sendComponent } from "@packages/web-shell";
import {
	countLiveAddresses,
	EmailLinkOrdinalSchema,
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
	InboxAddressSchema,
	isLiveAddress,
	normalizeAliasName,
} from "@packages/domain/inbox";
import { validateSaveableUrl } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type {
	InboxAddressStore,
	InboxEmailLinkStore,
	InboxEmailStore,
} from "@packages/domain/inbox";
import type { ContentProvider } from "@packages/provider-contracts/article-store";
import { emailContentResourceId } from "../../../domain/inbox/email-content-id";
import { stripUtmParams } from "../../../domain/inbox/strip-utm-params";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { MAX_POLLS } from "@packages/web-shell";
import { etagMatches } from "@packages/web-shell";
import { renderInboxArticleCard } from "./inbox-article-card.component";
import { renderInboxArticlesMore } from "./inbox-articles-more.component";
import { parseArticlesShown } from "./inbox-articles-more.url";
import { renderInboxArticlesPanel } from "./inbox-articles-panel.component";
import { renderInboxExcludedPanel } from "./inbox-excluded-panel.component";
import { InboxEmailDetailPage } from "./inbox-email-detail.component";
import { buildInboxEmailDetailUrl, parseMailTab } from "./inbox-email-detail.url";
import type { MailTabKey } from "./inbox-email-detail.url";
import { renderInboxLinkCount } from "./inbox-link-count.component";
import {
	buildCardResolvedAnnouncement,
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
import { toInboxLinkCardViewModel } from "./inbox-link-card.viewmodel";
import { parsePollParam } from "@packages/web-shell";
import { InboxPage } from "./inbox.component";

interface InboxDependencies {
	inboxAddressStore: InboxAddressStore;
	inboxEmailStore: InboxEmailStore;
	inboxEmailLinkStore: InboxEmailLinkStore;
	readEmailContent: ContentProvider;
	inboxAddressDomain: string;
	imagesCdnBaseUrl: string;
	logError: (message: string, error?: Error) => void;
	buildBannerState: BuildBannerState;
	publishSubmitLink: (input: { userId: UserId; url: string }) => Promise<void>;
	/** Save gates applied to the write actions — /create (a forwarding address is
	 * a save-flow input) and the per-link save (it lands an article in the
	 * reader's queue). Both gates run: `requireNotLocked` blocks a
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

const DisableAddressSchema = z.object({ address: InboxAddressSchema });
const CreateAddressSchema = z.object({ name: z.string() });
const LinkFeedbackSchema = z.object({
	verdict: z.enum(["should-be-included", "should-be-excluded"]),
});

export function initInboxRoutes(deps: InboxDependencies): Router {
	const router = express.Router();
	const addressesPath = "/inbox/addresses";
	const addressesCreateFailedPath = `${addressesPath}?error=create`;

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
		const needsAddressSetup =
			result.emails.length === 0 &&
			countLiveAddresses(await deps.inboxAddressStore.listAddressesByUserId(userId)) === 0;
		const vm = toInboxEmailsViewModel(result, { now: deps.now(), needsAddressSetup });
		sendComponent(req, res, Base(InboxEmailsPage(vm), await deps.buildBannerState(req)));
	});

	router.get("/addresses", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const addresses = await deps.inboxAddressStore.listAddressesByUserId(req.userId);
		const createFailed = req.query.error === "create";
		const nameInvalid = req.query.error === "name";
		const nameTaken = req.query.error === "name-taken";
		// Banner shows whenever the cap is genuinely reached, not only after a
		// rejected create. error=limit stays OR'd in so a just-rejected create
		// still shows it even when the eventually-consistent live read
		// (listAddressesByUserId) briefly undercounts and would otherwise drop it.
		const limitReached =
			req.query.error === "limit" || countLiveAddresses(addresses) >= INBOX_ADDRESS_MAX_PER_USER;
		sendComponent(
			req,
			res,
			Base(
				InboxPage({ addresses, createFailed, nameInvalid, nameTaken, limitReached }),
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
				maxPolls: MAX_POLLS,
				panelPollCount: requestedPoll + 1,
			});
			// The swap only replaces this one panel, so pair it with out-of-band swaps
			// of the header badge and the tab strip — otherwise their counts would lag
			// the swapped-in state until a full reload, and this poll is the only
			// request in flight.
			//
			// The tab strip ships ONLY on the tick that has counts to report. Until
			// then it would be byte-identical to the strip already on screen, and an
			// outerHTML swap replaces the tab links rather than editing them: a reader
			// keyboarding through the tabs would lose focus to <body> every few
			// seconds for the whole extraction window. The header badge is a bare
			// <span> with nothing focusable inside, so it rides every tick as before.
			const oobTabs = vm.extractionReported
				? renderInboxMailTabs({ tabs: vm.tabs, oob: true })
				: "";
			res
				.status(200)
				.type("html")
				.send(
					POLL_PANEL_RENDERERS[panel](vm) +
						renderInboxLinkCount({ label: vm.linkCountLabel, oob: true }) +
						oobTabs,
				);
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
			const etag = computeInboxLinkCardEtag(link);
			res.set("Cache-Control", "private, no-cache");
			res.set("Vary", "Cookie");
			res.set("ETag", etag);
			if (etagMatches(req.get("If-None-Match"), etag)) {
				res.status(304).end();
				return;
			}
			const requestedPoll = parsePollParam(req.query.poll, MAX_POLLS);
			const cardVm = toInboxLinkCardViewModel({
				link,
				emailId: receivedAtMessageId,
				pollCount: requestedPoll + 1,
				maxPolls: MAX_POLLS,
				shown: parseArticlesShown(req.query),
			});
			// The card only polls while it is pending, so a poll that finds the link
			// terminal is the transition itself — the one moment worth announcing.
			const announcement = buildCardResolvedAnnouncement({
				status: link.status,
				title: cardVm.title,
				url: cardVm.url,
			});
			const liveStatusHtml =
				announcement === ""
					? ""
					: renderInboxLiveStatus({ message: announcement, oob: true });
			res
				.status(200)
				.type("html")
				.send(`${renderInboxArticleCard(cardVm)}${liveStatusHtml}`);
		},
	);

	// The ERROR level is the point: link-classification feedback must surface in
	// the operator's CloudWatch error widget, not sit in an unwatched info stream.
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
				deps.logError(
					`[inbox-link-feedback] ${JSON.stringify({
						verdict: parsedBody.data.verdict,
						userId,
						receivedAtMessageId,
						ordinal: link.ordinal,
						url: link.url,
						status: link.status,
						skipReason: link.skipReason,
					})}`,
				);
			}
			// Back to the tab the reported row actually lives on: an include verdict
			// comes from a skipped row on the Skipped tab, an exclude verdict from
			// a card on Articles. A fixed tab would bounce the reader to a panel that
			// doesn't hold the link they just reported.
			const tab = link.status === "skipped" ? "excluded" : "articles";
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
			// A missing, skipped, or unsaveable link never renders Save, so a POST for
			// one is an out-of-band request, not a user path.
			if (
				link === undefined ||
				link.status === "skipped" ||
				validateSaveableUrl(link.url).status !== "SUCCESS"
			) {
				res.status(404).type("html").send("");
				return;
			}
			// A submitted link no longer renders Save either, but a stale second-tab
			// button or a replay can still POST it. Re-publishing would resurrect a
			// finished article (the downstream save runs markUnreadIfRead), so an
			// already-submitted save is answered idempotently — the publish and mark
			// skipped, the &saved=1 redirect not.
			if (link.submittedAt === undefined) {
				// Submits the stored URL, never the resolved one — the save pipeline owns
				// redirects. Stripping runs after the saveable gate above and only shortens,
				// so the validated URL cannot grow back past its length cap.
				await deps.publishSubmitLink({
					userId,
					url: link.status === "pending" ? link.url : stripUtmParams(link.url),
				});
				// Publish first, then mark: a failed mark under-promises (no marker, but the
				// command is out) where a failed publish after marking would over-promise a
				// save that never happened. The marker is what makes the saved card durable —
				// otherwise it reverts to an unsaved-looking card the moment the toast fades.
				await deps.inboxEmailLinkStore.markLinkSubmitted({
					userId,
					receivedAtMessageId,
					ordinal: link.ordinal,
					submittedAt: deps.now().toISOString(),
				});
			}
			res.redirect(
				303,
				`${buildInboxEmailDetailUrl({
					emailId: receivedAtMessageId,
					tab: "articles",
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
			res.redirect(303, `${addressesPath}?error=name-taken`);
			return;
		}
		try {
			await deps.inboxAddressStore.createAddress({
				userId,
				domain: deps.inboxAddressDomain,
				name,
			});
		} catch (error) {
			// Hitting the per-user cap is expected user behaviour, not a fault — echo
			// it back as a friendly message instead of logging an alerting-worthy error.
			if (error instanceof InboxAddressLimitReachedError) {
				res.redirect(303, `${addressesPath}?error=limit`);
				return;
			}
			deps.logError(
				"[Inbox] Failed to create a forwarding address",
				error instanceof Error ? error : new Error(String(error)),
			);
			res.redirect(303, addressesCreateFailedPath);
			return;
		}
		res.redirect(303, addressesPath);
	});

	router.post("/disable", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsed = DisableAddressSchema.safeParse(req.body);
		if (parsed.success) {
			// Confirm ownership before disabling so a forged address for someone
			// else's row never reaches the (also ownership-guarded) store write.
			const owned = await deps.inboxAddressStore.listAddressesByUserId(userId);
			if (owned.some((entry) => entry.address === parsed.data.address)) {
				await deps.inboxAddressStore.disableAddress({ userId, address: parsed.data.address });
			}
		}
		res.redirect(303, addressesPath);
	});

	return router;
}
