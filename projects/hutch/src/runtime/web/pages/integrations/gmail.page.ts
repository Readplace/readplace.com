import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { parsePollParam, sendComponent } from "@packages/web-shell";
import { ForwardableSenderSchema, aliasNameForSender, gmailConnectionState } from "@packages/domain/gmail";
import { addressCapReached, type InboxAddress, isLiveAddress, normalizeAliasName } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { HxRedirectPage } from "../../hx-redirect-page";
import { GmailPage, renderGmailPoll } from "./gmail.component";
import { buildGmailUrl, GMAIL_CONFIRM_MAX_POLLS, type GmailPageNotice } from "./gmail.url";
import { toGmailPageViewModel, toGmailPollViewModel } from "./gmail.viewmodel";
import { INTEGRATIONS_PATH } from "./gmail-connect.url";
import type { GmailIntegrationDependencies } from "./gmail-connect.page";

const SenderBodySchema = z.object({ sender: z.string() });

const AddSenderBodySchema = z.object({
	sender: z.string(),
	destination: z.string().optional(),
	inbox_name: z.string().optional(),
});

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

	const redirectFullPage = (req: Request, res: Response, url: string): void => {
		if (req.get("HX-Request") === "true") {
			sendComponent(req, res, HxRedirectPage(url));
			return;
		}
		res.redirect(303, url);
	};

	router.get("/gmail", requireAuth, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		if (connection === undefined || connection.disconnectRequestedAt !== undefined) {
			res.redirect(303, INTEGRATIONS_PATH);
			return;
		}
		const senders = await gmail.gmailSenderStore.listSendersByUserId(userId);
		const inboxes = await gmail.listInboxAddresses(userId);
		const gateway = await gmail.findInboxAddress(connection.gatewayAddress);
		const vm = toGmailPageViewModel({
			connection,
			senders,
			inboxes,
			gatewayLive: gateway !== undefined && isLiveAddress(gateway),
			error: flash(req, "error"),
			notice: flash(req, "notice"),
		});
		sendComponent(req, res, Base(GmailPage(vm), await context.buildBannerState(req)));
	});

	router.get("/gmail/status", requireAuth, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		if (connection === undefined) {
			redirectFullPage(req, res, INTEGRATIONS_PATH);
			return;
		}
		if (gmailConnectionState(connection) !== "awaiting-confirmation") {
			redirectFullPage(req, res, buildGmailUrl({ notice: "confirmed" }));
			return;
		}
		const pollCount = parsePollParam(req.query.poll, GMAIL_CONFIRM_MAX_POLLS);
		res
			.status(200)
			.set("Cache-Control", "private, no-cache")
			.type("html")
			.send(renderGmailPoll(toGmailPollViewModel({ pollCount })));
	});

	router.post("/gmail/senders/add", write, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const body = AddSenderBodySchema.safeParse(req.body);
		if (!body.success) {
			res.redirect(303, buildGmailUrl({ error: "sender_invalid" }));
			return;
		}
		const sender = ForwardableSenderSchema.safeParse(body.data.sender);
		if (!sender.success) {
			res.redirect(303, buildGmailUrl({ error: "sender_invalid" }));
			return;
		}
		const senderEmail = sender.data;
		const existing = await gmail.gmailSenderStore.findSender({ userId, senderEmail });
		if (existing?.addedToFilterAt !== undefined) {
			res.redirect(303, buildGmailUrl({ error: "sender_duplicate" }));
			return;
		}

		const destination = body.data.destination ?? "";
		if (destination !== "") {
			const owned = await gmail.listInboxAddresses(userId);
			let mappedAddress: InboxAddress;
			let notice: GmailPageNotice;
			if (destination === "new") {
				const rawName = (body.data.inbox_name ?? "").trim();
				const inboxName = rawName === "" ? aliasNameForSender(senderEmail) : normalizeAliasName(rawName);
				if (inboxName === undefined) {
					res.redirect(303, buildGmailUrl({ error: "inbox_name_invalid" }));
					return;
				}
				if (owned.some((entry) => isLiveAddress(entry) && entry.name === inboxName)) {
					res.redirect(303, buildGmailUrl({ error: "inbox_name_taken" }));
					return;
				}
				if (addressCapReached({ purpose: "gmail-mapped", owned })) {
					res.redirect(303, buildGmailUrl({ error: "inbox_limit" }));
					return;
				}
				mappedAddress = await gmail.mintInboxAddress({ userId, name: inboxName });
				notice = "inbox_created";
			} else {
				const inbox = owned.find(
					(entry) =>
						entry.address === destination && isLiveAddress(entry) && entry.purpose === "gmail-mapped",
				);
				if (inbox === undefined) {
					res.redirect(303, buildGmailUrl({ error: "inbox_name_invalid" }));
					return;
				}
				mappedAddress = inbox.address;
				notice = inbox.gmailConfirmedAt === undefined ? "inbox_confirmation_required" : "sender_mapped";
			}
			await gmail.gmailSenderStore.mapSenderToAddress({ userId, senderEmail, mappedAddress });
			await gmail.gmailSenderStore.addSenderToFilter({ userId, senderEmail });
			await gmail.publishRewriteGmailFilter({ userId, reason: "sender-added" });
			res.redirect(303, buildGmailUrl({ notice }));
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
		const owned = await gmail.listInboxAddresses(userId);
		if (addressCapReached({ purpose: "gmail-mapped", owned })) {
			res.redirect(303, buildGmailUrl({ error: "inbox_limit" }));
			return;
		}
		const mappedAddress = await gmail.mintInboxAddress({
			userId,
			name: aliasNameForSender(senderEmail),
		});
		await gmail.gmailSenderStore.mapSenderToAddress({ userId, senderEmail, mappedAddress });
		await gmail.gmailSenderStore.addSenderToFilter({ userId, senderEmail });
		await gmail.publishRewriteGmailFilter({ userId, reason: "sender-added" });
		res.redirect(303, buildGmailUrl({ notice: "inbox_created" }));
	});

	router.post("/gmail/disconnect", write, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		await gmail.gmailConnectionStore.markDisconnectRequested({ userId });
		await gmail.publishDisconnectGmail({ userId });
		res.redirect(303, INTEGRATIONS_PATH);
	});
}
