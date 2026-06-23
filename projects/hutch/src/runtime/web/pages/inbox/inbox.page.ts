import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { EMAIL_FEATURE, sendComponent } from "@packages/web-shell";
import { InboxAddressSchema } from "@packages/domain/inbox";
import type { InboxAddressStore } from "@packages/domain/inbox";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import type { QuerystringFeatureToggle } from "../../feature-toggle";
import { InboxPage } from "./inbox.component";

interface InboxDependencies {
	featureToggle: QuerystringFeatureToggle;
	inboxAddressStore: InboxAddressStore;
	inboxAddressDomain: string;
	logError: (message: string, error?: Error) => void;
	buildBannerState: BuildBannerState;
}

const DisableAddressSchema = z.object({ address: InboxAddressSchema });

export function initInboxRoutes(deps: InboxDependencies): Router {
	const router = express.Router();
	const inboxPath = `/inbox?feature=${EMAIL_FEATURE}`;

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
		const addresses = await deps.inboxAddressStore.listAddressesByUserId(req.userId);
		sendComponent(req, res, Base(InboxPage({ addresses }), await deps.buildBannerState(req)));
	});

	router.post("/create", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		try {
			await deps.inboxAddressStore.createAddress({
				userId: req.userId,
				domain: deps.inboxAddressDomain,
			});
		} catch (error) {
			deps.logError(
				"[Inbox] Failed to create a forwarding address",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
		res.redirect(303, inboxPath);
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
		res.redirect(303, inboxPath);
	});

	return router;
}
