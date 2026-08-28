import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { sendComponent } from "@packages/web-shell";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { GmailPage } from "./gmail.component";
import { buildGmailUrl } from "./gmail.url";
import { toGmailPageViewModel } from "./gmail.viewmodel";
import { INTEGRATIONS_PATH } from "./gmail-connect.url";
import type { GmailIntegrationDependencies } from "./gmail-connect.page";

const SenderBodySchema = z.object({ sender: z.string() });

export interface GmailPageContext {
	buildBannerState: BuildBannerState;
	requireAuth: RequestHandler;
	requireNotLocked: RequestHandler;
	requireWriteAccess: RequestHandler;
}

function flash(req: Request, key: "error" | "notice"): string | undefined {
	const value = req.query[key];
	return typeof value === "string" ? value : undefined;
}

function parseSender(req: Request) {
	const body = SenderBodySchema.safeParse(req.body);
	if (!body.success) return undefined;
	const sender = ForwardableSenderSchema.safeParse(body.data.sender);
	return sender.success ? sender.data : undefined;
}

export function registerGmailPageRoutes(
	router: Router,
	gmail: GmailIntegrationDependencies,
	context: GmailPageContext,
): void {
	const { requireAuth, requireNotLocked, requireWriteAccess } = context;
	const write = [requireAuth, requireNotLocked, requireWriteAccess];

	const ownerOf = (req: Request): UserId => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		return UserIdSchema.parse(req.userId);
	};

	router.get("/gmail", requireAuth, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		if (connection === undefined) {
			res.redirect(303, INTEGRATIONS_PATH);
			return;
		}
		const senders = await gmail.gmailSenderStore.listSendersByUserId(userId);
		const vm = toGmailPageViewModel({
			connection,
			senders,
			error: flash(req, "error"),
			notice: flash(req, "notice"),
		});
		sendComponent(req, res, Base(GmailPage(vm), await context.buildBannerState(req)));
	});

	router.post("/gmail/verify", write, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		await gmail.publishRewriteGmailFilter({ userId, reason: "requested" });
		res.redirect(303, buildGmailUrl({ notice: "verifying" }));
	});

	router.post("/gmail/senders/add", write, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const senderEmail = parseSender(req);
		if (senderEmail === undefined) {
			res.redirect(303, buildGmailUrl({ error: "sender_invalid" }));
			return;
		}
		const existing = await gmail.gmailSenderStore.findSender({ userId, senderEmail });
		if (existing?.addedToFilterAt !== undefined) {
			res.redirect(303, buildGmailUrl({ error: "sender_duplicate" }));
			return;
		}
		await gmail.gmailSenderStore.addSenderToFilter({ userId, senderEmail });
		await gmail.publishRewriteGmailFilter({ userId, reason: "sender-added" });
		res.redirect(303, buildGmailUrl({ notice: "sender_added" }));
	});

	router.post("/gmail/senders/remove", write, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const senderEmail = parseSender(req);
		if (senderEmail === undefined) {
			res.redirect(303, buildGmailUrl({ error: "sender_invalid" }));
			return;
		}
		await gmail.gmailSenderStore.removeSender({ userId, senderEmail });
		await gmail.publishRewriteGmailFilter({ userId, reason: "sender-removed" });
		res.redirect(303, buildGmailUrl({ notice: "sender_removed" }));
	});

	router.post("/gmail/senders/map", write, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const senderEmail = parseSender(req);
		if (senderEmail === undefined) {
			res.redirect(303, buildGmailUrl({ error: "sender_invalid" }));
			return;
		}
		const existing = await gmail.gmailSenderStore.findSender({ userId, senderEmail });
		if (existing === undefined) {
			res.redirect(303, buildGmailUrl({ error: "sender_unknown" }));
			return;
		}
		const mappedAddress = await gmail.mintSenderAddress({ userId, senderEmail });
		await gmail.gmailSenderStore.mapSenderToAddress({ userId, senderEmail, mappedAddress });
		await gmail.gmailSenderStore.addSenderToFilter({ userId, senderEmail });
		await gmail.publishRewriteGmailFilter({ userId, reason: "sender-added" });
		res.redirect(303, buildGmailUrl({ notice: "sender_mapped" }));
	});

	router.post("/gmail/disconnect", write, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		await gmail.publishDisconnectGmail({ userId });
		res.redirect(303, INTEGRATIONS_PATH);
	});
}
