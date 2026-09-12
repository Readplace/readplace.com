import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { parsePollParam, sendComponent } from "@packages/web-shell";
import { ForwardableSenderSchema, gmailConnectionState } from "@packages/domain/gmail";
import type { GmailConnection, GmailDiscovery } from "@packages/domain/gmail";
import {
	addressCapReached,
	type InboxAddress,
	InboxAddressLimitReachedError,
	InboxAddressSchema,
	isCappedAddress,
	isLiveAddress,
	normalizeAliasName,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import { GMAIL_METADATA_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { HxRedirectPage } from "../../hx-redirect-page";
import { GmailPage, renderGmailPoll, renderGmailSenderResults } from "./gmail.component";
import { buildGmailUrl, GMAIL_CONFIRM_MAX_POLLS, type GmailPageError } from "./gmail.url";
import { toGmailPageViewModel, toGmailPollViewModel } from "./gmail.viewmodel";
import { INTEGRATIONS_PATH } from "./gmail-connect.url";
import type { GmailIntegrationDependencies } from "./gmail-connect.page";

const SenderBodySchema = z.object({ sender: ForwardableSenderSchema });
const DestinationBodySchema = z.object({ destination: z.string().min(1) });
const AddSenderBodySchema = z.object({
	sender: ForwardableSenderSchema,
	destination: z.string().min(1),
	inbox_name: z.string().optional(),
});
const DiscoveryBodySchema = z.object({
	search: z.string().optional(),
	sender: z.string().optional(),
	destination: z.string().optional(),
});

export interface GmailPageContext {
	buildBannerState: BuildBannerState;
	requireAuth: RequestHandler;
	requireNotLocked: RequestHandler;
	requireWriteAccess: RequestHandler;
}

function queryValue(req: Request, key: string): string | undefined {
	const value = req.query[key];
	return typeof value === "string" ? value : undefined;
}

function discoveryMatchesConnection(discovery: GmailDiscovery | undefined, connection: GmailConnection): boolean {
	return discovery?.accountEmail.trim().toLowerCase() === connection.accountEmail?.trim().toLowerCase() && discovery?.gatewayAddress === connection.gatewayAddress;
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
	const connected: RequestHandler = async (req, res, next) => {
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(ownerOf(req));
		if (connection === undefined || connection.disconnectRequestedAt !== undefined) {
			redirectFullPage(req, res, INTEGRATIONS_PATH);
			return;
		}
		next();
	};
	const readPage = async (req: Request) => {
		const userId = ownerOf(req);
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		assert(connection, "the connected middleware requires a Gmail connection");
		const [senders, inboxes, gateway, discoveredSenders, discovery, grantedScope] = await Promise.all([
			gmail.gmailSenderStore.listSendersByUserId(userId),
			gmail.listInboxAddresses(userId),
			gmail.findInboxAddress(connection.gatewayAddress),
			gmail.gmailDiscoveryStore.listSendersByUserId(userId),
			gmail.gmailDiscoveryStore.findDiscoveryByUserId(userId),
			gmail.gmailCredentialsStore.findGrantedScopeByUserId(userId),
		]);
		const sameMailbox = discoveryMatchesConnection(discovery, connection);
		return toGmailPageViewModel({
			connection,
			senders,
			inboxes,
			gatewayLive: gateway !== undefined && isLiveAddress(gateway),
			discoveredSenders: sameMailbox ? discoveredSenders : [],
			discovery: discovery === undefined || !sameMailbox ? { state: "idle", scannedCount: 0 } : discovery,
			metadataScopeGranted: grantedScope?.split(" ").includes(GMAIL_METADATA_SCOPE) === true,
			search: queryValue(req, "search") ?? "",
			selectedSender: queryValue(req, "sender"),
			selectedDestination: queryValue(req, "destination"),
			inboxName: queryValue(req, "inbox_name"),
			discoveryAfter: queryValue(req, "discovery_after"),
			discoveryPending: queryValue(req, "discovery_after") === (discovery?.updatedAt ?? "none"),
			pollCount: parsePollParam(req.query.poll, GMAIL_CONFIRM_MAX_POLLS),
			discoveryStarted: queryValue(req, "discovery") === "started",
			error: queryValue(req, "error"),
			notice: queryValue(req, "notice"),
		});
	};

	router.get("/gmail", requireAuth, connected, async (req: Request, res: Response) => {
		const vm = await readPage(req);
		res.set("Cache-Control", "private, no-store");
		sendComponent(req, res, Base(GmailPage(vm), await context.buildBannerState(req)));
	});

	router.get("/gmail/senders", requireAuth, connected, async (req: Request, res: Response) => {
		const vm = await readPage(req);
		res.set("Cache-Control", "private, no-store");
		if (req.get("HX-Request") !== "true") {
			sendComponent(req, res, Base(GmailPage(vm), await context.buildBannerState(req)));
			return;
		}
		if (queryValue(req, "poll") === undefined) {
			res.set("HX-Push-Url", buildGmailUrl({ search: vm.search, sender: vm.selectedSender, destination: vm.selectedDestination, discovery: "started", discovery_after: vm.chooser.discoveryAfter }));
		}
		res.type("html").send(renderGmailSenderResults(vm));
	});

	router.post("/gmail/discovery/start", write, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const scope = await gmail.gmailCredentialsStore.findGrantedScopeByUserId(userId);
		if (scope?.split(" ").includes(GMAIL_METADATA_SCOPE) !== true) {
			res.redirect(303, buildGmailUrl({ error: "metadata_required" }));
			return;
		}
		const previous = await gmail.gmailDiscoveryStore.findDiscoveryByUserId(userId);
		await gmail.publishStartGmailSenderDiscovery({ userId });
		const body = DiscoveryBodySchema.safeParse(req.body);
		res.redirect(303, buildGmailUrl({ ...(body.success ? body.data : {}), discovery: "started", discovery_after: previous?.updatedAt ?? "none" }));
	});

	router.get("/gmail/status", requireAuth, async (req: Request, res: Response) => {
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(ownerOf(req));
		if (connection === undefined) {
			redirectFullPage(req, res, INTEGRATIONS_PATH);
			return;
		}
		if (gmailConnectionState(connection) !== "awaiting-confirmation") {
			redirectFullPage(req, res, buildGmailUrl({ notice: "confirmed" }));
			return;
		}
		const pollCount = parsePollParam(req.query.poll, GMAIL_CONFIRM_MAX_POLLS);
		res.status(200).set("Cache-Control", "private, no-cache").type("html")
			.send(renderGmailPoll(toGmailPollViewModel({ pollCount })));
	});

	router.post("/gmail/senders/add", write, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const body = AddSenderBodySchema.safeParse(req.body);
		if (!body.success) {
			res.redirect(303, buildGmailUrl({ error: "sender_invalid" }));
			return;
		}
		const { sender: senderEmail, destination, inbox_name: rawName } = body.data;
		const invalid = (error: GmailPageError): void => {
			res.redirect(303, buildGmailUrl({
				error, sender: senderEmail, destination, inbox_name: rawName, discovery: "started",
			}));
		};
		const [existing, discovered, discovery, connection] = await Promise.all([
			gmail.gmailSenderStore.findSender({ userId, senderEmail }),
			gmail.gmailDiscoveryStore.listSendersByUserId(userId),
			gmail.gmailDiscoveryStore.findDiscoveryByUserId(userId),
			gmail.gmailConnectionStore.findConnectionByUserId(userId),
		]);
		assert(connection, "the connected middleware requires a Gmail connection");
		if (existing?.addedToFilterAt === undefined && (!discoveryMatchesConnection(discovery, connection) || !discovered.some((sender) => sender.email === senderEmail))) {
			invalid("sender_unknown");
			return;
		}
		let mappedAddress: InboxAddress;
		if (destination === "new") {
			const name = normalizeAliasName(rawName ?? "");
			if (name === undefined) {
				invalid("inbox_name_invalid");
				return;
			}
			const owned = await gmail.listInboxAddresses(userId);
			if (owned.some((entry) => isLiveAddress(entry) && entry.name === name)) {
				invalid("inbox_name_taken");
				return;
			}
			if (addressCapReached({ purpose: "gmail-mapped", owned })) {
				invalid("inbox_limit");
				return;
			}
			try {
				mappedAddress = await gmail.mintInboxAddress({ userId, name });
			} catch (error) {
				if (!(error instanceof InboxAddressLimitReachedError)) throw error;
				invalid("inbox_limit");
				return;
			}
		} else {
			const address = InboxAddressSchema.safeParse(destination);
			const inbox = address.success ? await gmail.findInboxAddress(address.data) : undefined;
			if (inbox === undefined || inbox.userId !== userId || !isLiveAddress(inbox) || !isCappedAddress(inbox)) {
				invalid("destination_invalid");
				return;
			}
			mappedAddress = inbox.address;
		}
		await gmail.gmailSenderStore.mapSenderToAddress({ userId, senderEmail, mappedAddress });
		await gmail.gmailSenderStore.addSenderToFilter({ userId, senderEmail });
		await gmail.publishRewriteGmailFilter({ userId, reason: "sender-added" });
		res.redirect(303, buildGmailUrl({ notice: "sender_mapped", discovery: "started" }));
	});

	router.post("/gmail/senders/remove", write, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const body = SenderBodySchema.safeParse(req.body);
		if (!body.success) {
			res.redirect(303, buildGmailUrl({ error: "sender_invalid" }));
			return;
		}
		await gmail.gmailSenderStore.removeSender({ userId, senderEmail: body.data.sender });
		await gmail.publishRewriteGmailFilter({ userId, reason: "sender-removed" });
		res.redirect(303, buildGmailUrl({ notice: "sender_removed", discovery: "started" }));
	});

	router.post("/gmail/mappings/remove", write, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const body = DestinationBodySchema.safeParse(req.body);
		if (!body.success) {
			res.redirect(303, buildGmailUrl({ error: "destination_invalid" }));
			return;
		}
		const senders = await gmail.gmailSenderStore.listSendersByUserId(userId);
		const mappedAddress = body.data.destination === "legacy" ? undefined : body.data.destination;
		const group = senders.filter((sender) => sender.addedToFilterAt !== undefined && sender.mappedAddress === mappedAddress);
		await Promise.all(group.map((sender) => gmail.gmailSenderStore.removeSender({ userId, senderEmail: sender.senderEmail })));
		await gmail.publishRewriteGmailFilter({ userId, reason: "sender-removed" });
		res.redirect(303, buildGmailUrl({ notice: "mapping_removed", discovery: "started" }));
	});

	router.post("/gmail/disconnect", write, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		if (connection === undefined) {
			redirectFullPage(req, res, INTEGRATIONS_PATH);
			return;
		}
		await gmail.gmailConnectionStore.markDisconnectRequested({ userId });
		await gmail.publishDisconnectGmail({ userId });
		res.redirect(303, INTEGRATIONS_PATH);
	});
}
