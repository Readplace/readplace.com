import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { parsePollParam, sendComponent } from "@packages/web-shell";
import {
	ForwardableSenderSchema,
	GMAIL_HISTORY_IMPORT_MAX_POLLS,
	gmailConnectionState,
	hasGmailScope,
} from "@packages/domain/gmail";
import type { ForwardableSender, GmailConnection, GmailDiscovery } from "@packages/domain/gmail";
import { type InboxAddress, InboxAddressSchema, isLiveAddress } from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, READLIST_MAX_PER_USER, readerReadlists } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import { GMAIL_METADATA_SCOPE, GMAIL_READONLY_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { initMapSenderToReadlist } from "../../../domain/gmail/resolve-readlist-mapping";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { HxRedirectPage } from "../../hx-redirect-page";
import { GmailPage, renderGmailPoll, renderGmailSenderResults } from "./gmail.component";
import {
	buildGmailUrl,
	GMAIL_CONFIRM_MAX_POLLS,
	GMAIL_DISCOVERY_MAX_POLLS,
	type GmailPageError,
	type GmailPageNotice,
	GmailPollStateSchema,
	gmailSelectedReadlists,
	parseGmailPickerState,
} from "./gmail.url";
import { gmailPollState, toGmailPageViewModel, toGmailPollViewModel } from "./gmail.viewmodel";
import { buildIntegrationsUrl, INTEGRATIONS_PATH } from "./gmail-connect.url";
import { initGmailImportActions } from "./gmail-import-actions";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";
import { registerGmailMappingRoutes } from "./gmail-mappings.page";

const SenderBodySchema = z.object({ sender: ForwardableSenderSchema });
const SaveBodySchema = z.object({ readlist: z.union([z.string(), z.array(z.string())]).optional(), import: z.literal("1").optional().catch(undefined) });

export interface GmailPageContext {
	buildBannerState: BuildBannerState;
	requireAuth: RequestHandler;
	requireNotLocked: RequestHandler;
	requireWriteAccess: RequestHandler;
	now: () => Date;
}

function queryValue(req: Request, key: string): string | undefined {
	const value = req.query[key];
	return typeof value === "string" ? value : undefined;
}

function discoveryMatchesConnection(discovery: GmailDiscovery | undefined, connection: GmailConnection): boolean {
	return discovery?.accountEmail.trim().toLowerCase() === connection.accountEmail?.trim().toLowerCase() && discovery?.gatewayAddress === connection.gatewayAddress;
}

function destinationLookups(input: { connection: GmailConnection; mapped: readonly InboxAddress[] }): InboxAddress[] {
	const addresses = [...input.mapped];
	const filterError = input.connection.lastFilterError;
	if (filterError?.code === "query-too-long" && filterError.forwardTo !== input.connection.gatewayAddress) {
		addresses.push(InboxAddressSchema.parse(filterError.forwardTo));
	}
	return [...new Set(addresses)];
}

export function registerGmailPageRoutes(
	router: Router,
	gmail: GmailIntegrationDependencies,
	context: GmailPageContext,
): void {
	const { requireAuth, requireNotLocked, requireWriteAccess } = context;
	const requireGmailAuth: RequestHandler = (req, res, next) => {
		if (!req.userId) {
			res.redirect(303, `/login?return=${encodeURIComponent(req.originalUrl)}`);
			return;
		}
		requireAuth(req, res, next);
	};
	const write = [requireAuth, requireNotLocked, requireWriteAccess];
	const teardown = [requireAuth];
	const imports = initGmailImportActions({ gmail, now: context.now });
	const mapSenderToReadlist = initMapSenderToReadlist({
		senders: gmail.gmailSenderStore,
		getOrCreateReadlistAddress: gmail.getOrCreateReadlistAddress,
		cancelGmailHistoryImports: gmail.cancelGmailHistoryImports,
	});
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
		const [senders, gateway, discoveredSenders, discovery, grantedScope, definitions, jobs, observedSenders] = await Promise.all([
			gmail.gmailSenderStore.listSendersByUserId(userId),
			gmail.findInboxAddress(connection.gatewayAddress),
			gmail.gmailDiscoveryStore.listSendersByUserId(userId),
			gmail.gmailDiscoveryStore.findDiscoveryByUserId(userId),
			gmail.gmailCredentialsStore.findGrantedScopeByUserId(userId),
			gmail.listReadlistDefinitions(userId),
			gmail.gmailHistoryImportStore.listJobsByUserId(userId),
			connection.accountEmail === undefined ? [] : gmail.gmailMonitoringStore.listObservedSenders({ userId, accountEmail: connection.accountEmail }),
		]);
		const sameMailbox = discoveryMatchesConnection(discovery, connection);
		const discovered = [...new Map([...observedSenders, ...(sameMailbox ? discoveredSenders : [])].map((sender) => [sender.email, sender])).values()];
		const candidates: ForwardableSender[] = [
			...discovered.map((sender) => sender.email),
			...senders.filter((sender) => sender.addedToFilterAt !== undefined).map((sender) => sender.senderEmail),
		];
		const [detection, entries] = await Promise.all([
			gmail.detectNewsletters([...new Set(candidates)]),
			Promise.all(destinationLookups({ connection, mapped: senders.flatMap((sender) => sender.mappedAddresses ?? []) }).map((address) => gmail.findInboxAddress(address))),
		]);
		return toGmailPageViewModel({
			userId,
			connection,
			senders,
			destinations: new Map(entries.flatMap((entry) => (entry === undefined ? [] : [[entry.address, entry] as const]))),
			readlists: readerReadlists(definitions),
			readlistLimitReached: definitions.length >= READLIST_MAX_PER_USER,
			gatewayLive: gateway !== undefined && isLiveAddress(gateway),
			metadataScopeGranted: hasGmailScope({ grantedScope, scope: GMAIL_METADATA_SCOPE }),
			readonlyScopeGranted: hasGmailScope({ grantedScope, scope: GMAIL_READONLY_SCOPE }),
			discoveredSenders: discovered,
			discovery: discovery === undefined || !sameMailbox
				? { state: "idle", mode: "profile", checkedMessageCount: 0 }
				: discovery,
			detection,
			imports: jobs,
			state: queryValue(req, "confirm_readlists") === queryValue(req, "sender") && queryValue(req, "confirm_readlists") !== undefined
				? { ...parseGmailPickerState(req.query), edit: undefined, readlist_choice_for: queryValue(req, "readlist_choice_for") === queryValue(req, "sender") ? undefined : queryValue(req, "readlist_choice_for") }
				: parseGmailPickerState(req.query),
			discoveryStarted: queryValue(req, "discovery") === "started",
			discoveryPending: queryValue(req, "discovery_after") === (discovery?.updatedAt ?? "none"),
			pollCount: parsePollParam(req.query.poll, GMAIL_DISCOVERY_MAX_POLLS),
			importsPollCount: parsePollParam(req.query.imports_poll, GMAIL_HISTORY_IMPORT_MAX_POLLS),
			error: queryValue(req, "error"),
			notice: queryValue(req, "notice"),
			notification: queryValue(req, "notification") === "1",
		});
	};

	router.get("/gmail", requireGmailAuth, connected, async (req: Request, res: Response) => {
		const vm = await readPage(req);
		res.set("Cache-Control", "private, no-store");
		if (queryValue(req, "confirm_readlists") !== undefined) {
			if (req.get("HX-Request") !== "true") {
				res.redirect(303, vm.pageUrl);
				return;
			}
			res.set("HX-Push-Url", vm.pageUrl);
		}
		sendComponent(req, res, Base(GmailPage(vm), await context.buildBannerState(req)));
	});

	router.get("/gmail/senders", requireAuth, connected, async (req: Request, res: Response) => {
		const vm = await readPage(req);
		res.set("Cache-Control", "private, no-store");
		if (req.get("HX-Request") !== "true") {
			sendComponent(req, res, Base(GmailPage(vm), await context.buildBannerState(req)));
			return;
		}
		const searching = queryValue(req, "poll") === undefined;
		if (searching) res.set("HX-Push-Url", vm.pageUrl);
		res.type("html").send(renderGmailSenderResults(vm, { outOfBandLoadButton: true, outOfBandState: searching }));
	});

	router.post("/gmail/discovery/start", write, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const scope = await gmail.gmailCredentialsStore.findGrantedScopeByUserId(userId);
		if (!hasGmailScope({ grantedScope: scope, scope: GMAIL_METADATA_SCOPE })) {
			res.redirect(303, buildGmailUrl({ error: "metadata_required" }));
			return;
		}
		const previous = await gmail.gmailDiscoveryStore.findDiscoveryByUserId(userId);
		await gmail.publishStartGmailSenderDiscovery({ userId });
		const { discovery_after: _stale, ...state } = parseGmailPickerState(req.body);
		res.redirect(303, buildGmailUrl({ ...state, discovery: "started", discovery_after: previous?.updatedAt ?? "none" }));
	});

	router.get("/gmail/status", requireAuth, async (req: Request, res: Response) => {
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(ownerOf(req));
		if (connection === undefined) {
			redirectFullPage(req, res, INTEGRATIONS_PATH);
			return;
		}
		const pollState = gmailPollState(gmailConnectionState(connection));
		if (pollState === undefined) {
			redirectFullPage(req, res, buildGmailUrl({ ...parseGmailPickerState(req.query), notice: "confirmed" }));
			return;
		}
		const requestedState = GmailPollStateSchema.safeParse(req.query.state);
		if (!requestedState.success || requestedState.data !== pollState) {
			redirectFullPage(req, res, buildGmailUrl(parseGmailPickerState(req.query)));
			return;
		}
		const pollCount = parsePollParam(req.query.poll, GMAIL_CONFIRM_MAX_POLLS);
		res.status(200).set("Cache-Control", "private, no-cache").type("html")
			.send(renderGmailPoll(toGmailPollViewModel({ pollCount, state: pollState, picker: parseGmailPickerState(req.query) })));
	});

	router.post("/gmail/senders/add", write, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const state = parseGmailPickerState(req.body);
		const parsedSave = SaveBodySchema.safeParse(req.body);
		const saved = parsedSave.success ? parsedSave.data : { import: undefined };
		const invalid = (error: GmailPageError): void => {
			res.redirect(303, buildGmailUrl({
				...state,
				import: saved.import,
				error,
				discovery: "started",
			}));
		};
		if (!parsedSave.success) {
			invalid("readlist_invalid");
			return;
		}
		const sender = SenderBodySchema.safeParse(req.body);
		if (!sender.success) {
			invalid("sender_invalid");
			return;
		}
		const senderEmail = sender.data.sender;
		const [existing, discovered, discovery, connection, definitions] = await Promise.all([
			gmail.gmailSenderStore.findSender({ userId, senderEmail }),
			gmail.gmailDiscoveryStore.listSendersByUserId(userId),
			gmail.gmailDiscoveryStore.findDiscoveryByUserId(userId),
			gmail.gmailConnectionStore.findConnectionByUserId(userId),
			gmail.listReadlistDefinitions(userId),
		]);
		assert(connection, "the connected middleware requires a Gmail connection");
		const observed = connection.accountEmail === undefined ? [] : await gmail.gmailMonitoringStore.listObservedSenders({ userId, accountEmail: connection.accountEmail });
		const senderDiscovered = discoveryMatchesConnection(discovery, connection) && discovered.some((entry) => entry.email === senderEmail);
		if (existing?.addedToFilterAt === undefined && !senderDiscovered && !observed.some((entry) => entry.email === senderEmail)) {
			invalid("sender_unknown");
			return;
		}
		const choices = [...new Set(gmailSelectedReadlists(state))];
		const readlists = readerReadlists(definitions);
		if (choices.some((slug) => !readlists.some((entry) => entry.slug === slug))) {
			invalid("readlist_invalid");
			return;
		}
		if (state.readlist_choice_for === senderEmail && existing?.mappedAddresses === undefined && definitions.length > 0) {
			invalid("readlist_choice_required");
			return;
		}
		const selected = readlists.filter((entry) => entry.slug !== DEFAULT_READLIST_SLUG && choices.includes(entry.slug));
		const { destinations } = await mapSenderToReadlist({ userId, sender: senderEmail, readlists: selected.map((entry) => entry.slug) });
		await gmail.publishRewriteGmailFilter({ userId, reason: "sender-added" });
		const detection = await gmail.detectNewsletters([senderEmail]);
		if (detection.status === "unavailable" || detection.recognized.get(senderEmail)?.match !== "exact") {
			await gmail.publishSubmitNewsletterSender({ senderEmail });
		}
		const kept = { search: state.search, advanced: state.advanced, discovery: "started" as const };
		const newMapping = existing?.addedToFilterAt === undefined;
		if (!newMapping || saved.import !== "1") {
			const notice: GmailPageNotice = newMapping ? "sender_mapped" : "sender_remapped";
			res.redirect(303, buildGmailUrl({ ...kept, notice }));
			return;
		}
		const outcome = await imports.start({ userId, sender: senderEmail, destinations, connection });
		res.redirect(303, buildGmailUrl({ ...kept, ...(outcome.ok ? { notice: outcome.notice } : { notice: "sender_mapped", error: outcome.error }) }));
	});

	router.post("/gmail/filter/retry", write, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		assert(connection, "the connected middleware requires a Gmail connection");
		if (connection.forwardingConfirmedAt === undefined || connection.revokedAt !== undefined) {
			res.redirect(303, buildGmailUrl());
			return;
		}
		await gmail.publishRewriteGmailFilter({ userId, reason: "retry-requested" });
		res.redirect(303, buildGmailUrl({ notice: "filter_retry_requested" }));
	});

	router.post("/gmail/disconnect", teardown, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		if (connection === undefined) {
			redirectFullPage(req, res, INTEGRATIONS_PATH);
			return;
		}
		await gmail.gmailConnectionStore.markDisconnectRequested({ userId });
		await gmail.cancelGmailHistoryImports({ userId, senderEmail: undefined, reason: "disconnected" });
		await gmail.publishDisconnectGmail({ userId });
		res.redirect(303, buildIntegrationsUrl({ notice: "gmail_disconnected" }));
	});

	registerGmailMappingRoutes(router, gmail, { write, teardown, connected, ownerOf, imports });
}
