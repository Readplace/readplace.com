import assert from "node:assert";
import express, { type Request, type Response, type Router } from "express";
import {
	NewsletterMessageIdSchema,
	buildInboxAddress,
	type NewsletterInboxStore,
	type NewsletterMessageStore,
} from "@packages/domain/newsletter";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { sendComponent } from "../../send-component";
import { NewsletterDetailPage, NewsletterListPage } from "./newsletter.component";
import {
	toNewsletterDetailViewModel,
	toNewsletterListViewModel,
} from "./newsletter.viewmodel";

interface NewsletterRouteDeps {
	newsletterInboxStore: NewsletterInboxStore;
	newsletterMessageStore: NewsletterMessageStore;
	inboxDomain: string;
	buildBannerState: BuildBannerState;
}

export function initNewsletterRoutes(deps: NewsletterRouteDeps): Router {
	const router = express.Router();

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const inbox = await deps.newsletterInboxStore.getOrCreateInbox(req.userId);
		const address = buildInboxAddress({ token: inbox.token, domain: deps.inboxDomain });
		const messages = await deps.newsletterMessageStore.listMessages(req.userId);
		const vm = toNewsletterListViewModel({ address, messages });
		sendComponent(req, res, Base(NewsletterListPage(vm), await deps.buildBannerState(req)));
	});

	router.get("/:id", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const parsedId = NewsletterMessageIdSchema.safeParse(req.params.id);
		if (!parsedId.success) {
			res.redirect(303, "/newsletter");
			return;
		}
		const message = await deps.newsletterMessageStore.findMessage({
			userId: req.userId,
			id: parsedId.data,
		});
		if (!message) {
			res.redirect(303, "/newsletter");
			return;
		}
		sendComponent(
			req,
			res,
			Base(NewsletterDetailPage(toNewsletterDetailViewModel(message)), await deps.buildBannerState(req)),
		);
	});

	return router;
}
