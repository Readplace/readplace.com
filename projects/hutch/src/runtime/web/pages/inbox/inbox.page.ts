import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { EMAIL_FEATURE, sendComponent } from "@packages/web-shell";
import {
	countLiveAddresses,
	EmailLinkOrdinalSchema,
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
	InboxAddressSchema,
} from "@packages/domain/inbox";
import type {
	InboxAddressStore,
	InboxEmailLinkStore,
	InboxEmailStore,
} from "@packages/domain/inbox";
import type { ContentProvider } from "@packages/provider-contracts/article-store";
import { emailContentResourceId } from "../../../domain/inbox/email-content-id";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import type { QuerystringFeatureToggle } from "../../feature-toggle";
import { MAX_POLLS } from "../../shared/article-reader/article-reader";
import { etagMatches } from "../queue/queue-card/queue-card.etag";
import { renderInboxArticleCard } from "./inbox-article-card.component";
import { renderInboxArticlesPanel } from "./inbox-articles-panel.component";
import { InboxEmailDetailPage } from "./inbox-email-detail.component";
import { renderInboxLinkCount } from "./inbox-link-count.component";
import { toInboxEmailDetailViewModel } from "./inbox-email-detail.viewmodel";
import { InboxEmailsPage } from "./inbox-emails.component";
import { type InboxEmailLinkSummary, toInboxEmailsViewModel } from "./inbox-emails.viewmodel";
import { computeInboxLinkCardEtag } from "./inbox-link-card.etag";
import { toInboxLinkCardViewModel } from "./inbox-link-card.viewmodel";
import { InboxPage } from "./inbox.component";

interface InboxDependencies {
	featureToggle: QuerystringFeatureToggle;
	inboxAddressStore: InboxAddressStore;
	inboxEmailStore: InboxEmailStore;
	inboxEmailLinkStore: InboxEmailLinkStore;
	readEmailContent: ContentProvider;
	inboxAddressDomain: string;
	logError: (message: string, error?: Error) => void;
	buildBannerState: BuildBannerState;
	/** Save gates applied only to /create, the sole route that mints an address —
	 * a forwarding address is a save-flow input, so creating one is a write action.
	 * Both gates run: `requireNotLocked` blocks a
	 * locked (unverified-past-window) account, `requireWriteAccess` blocks a
	 * read-only (trial-expired / cancelled) account. Viewing and disabling existing
	 * addresses stay open — disabling reduces footprint and is harmless. */
	requireNotLocked: RequestHandler;
	requireWriteAccess: RequestHandler;
	now: () => Date;
}

const DisableAddressSchema = z.object({ address: InboxAddressSchema });

export function initInboxRoutes(deps: InboxDependencies): Router {
	const router = express.Router();
	const addressesPath = `/inbox/addresses?feature=${EMAIL_FEATURE}`;
	const addressesCreateFailedPath = `${addressesPath}&error=create`;

	/** Hidden by default: without the per-request flag the whole surface 404s, so
	 * production traffic never sees it until the flag is flipped on a request. */
	router.use((req: Request, res: Response, next: express.NextFunction) => {
		if (!deps.featureToggle.isEnabled(req, EMAIL_FEATURE)) {
			res.status(404).type("html").send("");
			return;
		}
		next();
	});

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const emails = await deps.inboxEmailStore.listEmailsByUserId(userId);
		// One cheap per-email partition Query each (no GSI, no scan) — the accepted
		// cost of deriving the count instead of denormalising it onto the email row.
		// Fired concurrently so a heavy-newsletter user pays one round-trip, not N.
		const summaries = await Promise.all(
			emails.map(async (email): Promise<[string, InboxEmailLinkSummary]> => {
				const { links, meta } = await deps.inboxEmailLinkStore.listLinksByEmail({
					userId,
					receivedAtMessageId: email.receivedAtMessageId,
				});
				return [
					email.receivedAtMessageId,
					{ count: links.length, truncated: meta?.truncated === true },
				];
			}),
		);
		const linkSummaries = new Map<string, InboxEmailLinkSummary>(summaries);
		const vm = toInboxEmailsViewModel(emails, { now: deps.now(), linkSummaries });
		sendComponent(req, res, Base(InboxEmailsPage(vm), await deps.buildBannerState(req)));
	});

	router.get("/addresses", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const addresses = await deps.inboxAddressStore.listAddressesByUserId(req.userId);
		const createFailed = req.query.error === "create";
		// Banner shows whenever the cap is genuinely reached, not only after a
		// rejected create. &error=limit stays OR'd in so a just-rejected create
		// still shows it even when the eventually-consistent live read
		// (listAddressesByUserId) briefly undercounts and would otherwise drop it.
		const limitReached =
			req.query.error === "limit" || countLiveAddresses(addresses) >= INBOX_ADDRESS_MAX_PER_USER;
		sendComponent(
			req,
			res,
			Base(InboxPage({ addresses, createFailed, limitReached }), await deps.buildBannerState(req)),
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
		const bodyHtml =
			entry.status === "received"
				? await deps.readEmailContent(
						emailContentResourceId({ userId: req.userId, receivedAtMessageId }),
					)
				: undefined;
		const { links, meta } = await deps.inboxEmailLinkStore.listLinksByEmail({
			userId: req.userId,
			receivedAtMessageId,
		});
		const vm = toInboxEmailDetailViewModel({
			entry,
			bodyHtml,
			links,
			linksMeta: meta,
			maxPolls: MAX_POLLS,
		});
		sendComponent(req, res, Base(InboxEmailDetailPage(vm), await deps.buildBannerState(req)));
	});

	// Page-level poll for the Articles panel while extraction is still running.
	// Until the extractor writes the per-email meta barrier there are no link rows
	// to poll, so the panel polls itself here and swaps in the finished card set
	// (or the terminal "no links" state) the instant extraction writes its meta.
	// The literal `articles` suffix keeps `/:id` (single segment) from capturing it.
	router.get("/:id/articles", async (req: Request<{ id: string }>, res: Response) => {
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
		const requestedPoll = Number(req.query.poll ?? "0");
		const vm = toInboxEmailDetailViewModel({
			entry,
			bodyHtml: undefined,
			links,
			linksMeta: meta,
			maxPolls: MAX_POLLS,
			panelPollCount: requestedPoll + 1,
		});
		// The panel swap only replaces the Articles section, so pair it with an
		// out-of-band swap of the header badge — otherwise the count would lag the
		// swapped-in card set until a full reload. While extraction is still pending
		// the label is undefined, so the OOB badge stays empty and the header keeps
		// withholding the count in lockstep with the panel.
		res
			.status(200)
			.type("html")
			.send(
				renderInboxArticlesPanel(vm.articles) +
					renderInboxLinkCount({ label: vm.linkCountLabel, oob: true }),
			);
	});

	// The literal `links/:ordinal/card` suffix means `/:id` (single segment)
	// never captures it. Renders one link-preview card fragment for the htmx
	// poll; 304s when the link hasn't changed during the wait window.
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
			if (link === undefined) {
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
			const requestedPoll = Number(req.query.poll ?? "0");
			const cardVm = toInboxLinkCardViewModel({
				link,
				emailId: receivedAtMessageId,
				pollCount: requestedPoll + 1,
				maxPolls: MAX_POLLS,
			});
			res.status(200).type("html").send(renderInboxArticleCard(cardVm));
		},
	);

	router.post("/create", deps.requireNotLocked, deps.requireWriteAccess, async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		try {
			await deps.inboxAddressStore.createAddress({
				userId: req.userId,
				domain: deps.inboxAddressDomain,
			});
		} catch (error) {
			// Hitting the per-user cap is expected user behaviour, not a fault — echo
			// it back as a friendly message instead of logging an alerting-worthy error.
			if (error instanceof InboxAddressLimitReachedError) {
				res.redirect(303, `${addressesPath}&error=limit`);
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
