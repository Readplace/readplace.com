import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { EMAIL_FEATURE, sendComponent } from "@packages/web-shell";
import {
	countLiveAddresses,
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
	InboxAddressSchema,
} from "@packages/domain/inbox";
import type { InboxAddressStore, InboxEmailStore } from "@packages/domain/inbox";
import type { ContentProvider } from "@packages/provider-contracts/article-store";
import { emailContentResourceId } from "../../../domain/inbox/email-content-id";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import type { QuerystringFeatureToggle } from "../../feature-toggle";
import { InboxEmailDetailPage } from "./inbox-email-detail.component";
import { toInboxEmailDetailViewModel } from "./inbox-email-detail.viewmodel";
import { InboxEmailsPage } from "./inbox-emails.component";
import { toInboxEmailsViewModel } from "./inbox-emails.viewmodel";
import { InboxPage } from "./inbox.component";

interface InboxDependencies {
	featureToggle: QuerystringFeatureToggle;
	inboxAddressStore: InboxAddressStore;
	inboxEmailStore: InboxEmailStore;
	readEmailContent: ContentProvider;
	inboxAddressDomain: string;
	logError: (message: string, error?: Error) => void;
	buildBannerState: BuildBannerState;
	/** Save gates applied only to /create, the sole route that mints an address —
	 * a forwarding address is a save-flow input, so creating one is a write action.
	 * Mirrors the import commit gate, which runs both: `requireNotLocked` blocks a
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
		const emails = await deps.inboxEmailStore.listEmailsByUserId(req.userId);
		const vm = toInboxEmailsViewModel(emails, { now: deps.now() });
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
		const vm = toInboxEmailDetailViewModel({ entry, bodyHtml });
		sendComponent(req, res, Base(InboxEmailDetailPage(vm), await deps.buildBannerState(req)));
	});

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
