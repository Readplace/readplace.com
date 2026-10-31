import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { parsePollParam, sendComponent } from "@packages/web-shell";
import {
	ForwardableSenderSchema,
	GMAIL_HISTORY_IMPORT_MAX_POLLS,
	gmailConnectionState,
	hasAnyGmailScope,
	hasGmailScope,
} from "@packages/domain/gmail";
import type { ForwardableSender, GmailConnection } from "@packages/domain/gmail";
import { type InboxAddress, InboxAddressSchema, isLiveAddress } from "@packages/domain/inbox";
import { READLIST_MAX_PER_USER, readerReadlists } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import { GMAIL_MESSAGE_READ_SCOPES, GMAIL_METADATA_SCOPE, GMAIL_MODIFY_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { GetEffectiveAccess } from "@packages/subscription-access";
import { initMapSenderToReadlist } from "../../../domain/gmail/resolve-readlist-mapping";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { HxRedirectPage } from "../../hx-redirect-page";
import { GmailPage, renderGmailPoll, renderGmailSenderResults, renderGmailSenderStatus } from "./gmail.component";
import {
	buildGmailUrl,
	confirmGmailReadlists,
	GMAIL_COMMAND_PARAMS,
	GMAIL_CONFIRM_MAX_POLLS,
	GMAIL_DIALOG_BODY_ID,
	GMAIL_DISCOVERY_MAX_POLLS,
	GmailPollStateSchema,
	parseGmailPickerState,
} from "./gmail.url";
import { gmailPollState, toGmailPageViewModel, toGmailPollViewModel } from "./gmail.viewmodel";
import { buildIntegrationsUrl, INTEGRATIONS_PATH } from "./gmail-connect.url";
import { canConnectGmail } from "./gmail-connection-access";
import { initGmailImportActions } from "./gmail-import-actions";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";
import { registerGmailMappingRoutes } from "./gmail-mappings.page";
import type { GmailOAuthConsent } from "./gmail-oauth-consent";
import { discoveryMatchesConnection, initSaveGmailSenders } from "./gmail-save-senders";

const SelectCommandSchema = z.enum(["all", "none"]);
const ListedSchema = z.coerce.number().int().nonnegative();
const SavedSchema = z.coerce.number().int().positive();

export interface GmailPageContext {
	buildBannerState: BuildBannerState;
	getEffectiveAccess: GetEffectiveAccess;
	requireAuth: RequestHandler;
	requireNotLocked: RequestHandler;
	requireWriteAccess: RequestHandler;
	now: () => Date;
	consent: GmailOAuthConsent;
}

function queryValue(req: Request, key: string): string | undefined {
	const value = req.query[key];
	return typeof value === "string" ? value : undefined;
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
		mappings: gmail.gmailMappingStore,
		getOrCreateReadlistAddress: gmail.getOrCreateReadlistAddress,
		cancelGmailHistoryImports: gmail.cancelGmailHistoryImports,
	});
	const saveGmailSenders = initSaveGmailSenders({ gmail, imports, mapSenderToReadlist });
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
		const [senders, gateway, discoveredSenders, discovery, grantedScope, definitions, jobs, observedSenders, access, backfills] = await Promise.all([
			connection.accountEmail === undefined ? [] : gmail.gmailMappingStore.listMappings({ userId, accountEmail: connection.accountEmail }),
			gmail.findInboxAddress(connection.gatewayAddress),
			gmail.gmailDiscoveryStore.listSendersByUserId(userId),
			gmail.gmailDiscoveryStore.findDiscoveryByUserId(userId),
			gmail.gmailCredentialsStore.findGrantedScopeByUserId(userId),
			gmail.listReadlistDefinitions(userId),
			gmail.gmailHistoryImportStore.listJobsByUserId(userId),
			connection.accountEmail === undefined ? [] : gmail.gmailMonitoringStore.listObservedSenders({ userId, accountEmail: connection.accountEmail }),
			context.getEffectiveAccess(userId),
			gmail.gmailMarkBackfillStore.listBackfillsByUserId(userId),
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
		const pick = ForwardableSenderSchema.safeParse(req.query.pick);
		const select = SelectCommandSchema.safeParse(req.query.select);
		const dismiss = ForwardableSenderSchema.safeParse(req.query.dismiss);
		const listed = ListedSchema.safeParse(req.query.listed);
		const saved = SavedSchema.safeParse(req.query.saved);
		return toGmailPageViewModel({
			userId,
			canConnectGmail: canConnectGmail(access),
			connection,
			senders,
			destinations: new Map(entries.flatMap((entry) => (entry === undefined ? [] : [[entry.address, entry] as const]))),
			readlists: readerReadlists(definitions),
			readlistLimitReached: definitions.length >= READLIST_MAX_PER_USER,
			gatewayLive: gateway !== undefined && isLiveAddress(gateway),
			metadataScopeGranted: hasGmailScope({ grantedScope, scope: GMAIL_METADATA_SCOPE }),
			readScopeGranted: hasAnyGmailScope({ grantedScope, scopes: GMAIL_MESSAGE_READ_SCOPES }),
			modifyScopeGranted: hasGmailScope({ grantedScope, scope: GMAIL_MODIFY_SCOPE }),
			discoveredSenders: discovered,
			discovery: discovery === undefined || !sameMailbox
				? { state: "idle", mode: "profile", checkedMessageCount: 0 }
				: discovery,
			detection,
			imports: jobs,
			backfills,
			state: queryValue(req, "confirm_readlists") === "1"
				? confirmGmailReadlists(parseGmailPickerState(req.query))
				: parseGmailPickerState(req.query),
			command: {
				pick: pick.success ? pick.data : undefined,
				select: select.success ? select.data : undefined,
				dismiss: dismiss.success ? dismiss.data : undefined,
			},
			listed: listed.success ? listed.data : undefined,
			discoveryStarted: queryValue(req, "discovery") === "started",
			discoveryPending: queryValue(req, "discovery_after") === (discovery?.updatedAt ?? "none"),
			pollCount: parsePollParam(req.query.poll, GMAIL_DISCOVERY_MAX_POLLS),
			importsPollCount: parsePollParam(req.query.imports_poll, GMAIL_HISTORY_IMPORT_MAX_POLLS),
			error: queryValue(req, "error"),
			notice: queryValue(req, "notice"),
			saved: saved.success ? saved.data : undefined,
			notification: queryValue(req, "notification") === "1",
			focusOnOpen: req.get("HX-Target") !== GMAIL_DIALOG_BODY_ID,
		});
	};

	router.get("/gmail", requireGmailAuth, connected, async (req: Request, res: Response) => {
		const vm = await readPage(req);
		const boosted = req.get("HX-Request") === "true";
		res.set("Cache-Control", "private, no-store");
		if (GMAIL_COMMAND_PARAMS.some((param) => req.query[param] !== undefined)) {
			if (!boosted) {
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
		if (queryValue(req, "poll") !== undefined) {
			res.type("html").send(renderGmailSenderStatus(vm, { outOfBandLoadButton: true }));
			return;
		}
		res.set("HX-Push-Url", vm.pageUrl);
		res.type("html").send(renderGmailSenderResults(vm, { outOfBandState: true }));
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
		const outcome = await saveGmailSenders({ userId, body: req.body });
		if (outcome.kind === "redirect") {
			res.redirect(303, outcome.url);
			return;
		}
		const { senders, state, savedNotice } = outcome;
		const consent = await context.consent.beginMarkConsent({ req, res, route: "save", userId, senders, state });
		if (consent === "no-access") res.redirect(303, buildGmailUrl({ ...state, ...savedNotice, discovery: "started" }));
		if (consent === "state-too-large") res.redirect(303, buildGmailUrl({ ...state, notice: "mark_permission_needed", discovery: "started" }));
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

	registerGmailMappingRoutes(router, gmail, { write, teardown, connected, ownerOf, imports, consent: context.consent, now: context.now });
}
