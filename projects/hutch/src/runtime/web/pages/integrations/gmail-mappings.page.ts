import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { type ForwardableSender, ForwardableSenderSchema, type GmailAccountEmail, type GmailConnection, GmailHistoryImportJobIdSchema } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import { initDiscardPendingGmailUpdatesForSender } from "../../../domain/gmail/discard-pending-gmail-updates";
import { type GmailImportActions, importFollowsMapping, UNFINISHED_IMPORT_STATES } from "./gmail-import-actions";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";
import { initGmailMarkActions } from "./gmail-mark-actions";
import type { GmailOAuthConsent } from "./gmail-oauth-consent";
import { buildGmailUrl, closeGmailDialog, confirmGmailReadlists, type GmailPageError, type GmailPageNotice, type GmailPickerState, parseGmailPickerState, gmailSelectedReadlists } from "./gmail.url";

const SenderBodySchema = z.object({ sender: ForwardableSenderSchema });
const JobBodySchema = z.object({ job: GmailHistoryImportJobIdSchema });
const OptionBoxSchema = z.object({ option: z.literal("on").optional().catch(undefined) });

export interface GmailMappingRoutesContext {
	write: RequestHandler[];
	teardown: RequestHandler[];
	connected: RequestHandler;
	ownerOf: (req: Request) => UserId;
	imports: GmailImportActions;
	consent: GmailOAuthConsent;
	now: () => Date;
}

function listState(body: unknown): GmailPickerState {
	const { sender: _sender, ...state } = closeGmailDialog(parseGmailPickerState(body));
	return state;
}

function redirectTo(res: Response, state: GmailPickerState, outcome: { error?: GmailPageError; notice?: GmailPageNotice } = {}): void {
	res.redirect(303, buildGmailUrl({ ...state, ...outcome, discovery: "started" }));
}

export function registerGmailMappingRoutes(
	router: Router,
	gmail: GmailIntegrationDependencies,
	context: GmailMappingRoutesContext,
): void {
	const { write, teardown, connected, ownerOf, imports, consent, now } = context;
	const { readlistDestinations, mappedNewsletter } = initGmailMarkActions({ gmail });
	const discardPendingForSender = initDiscardPendingGmailUpdatesForSender({
		listPendingByAccount: gmail.gmailMessageUpdateStore.listPendingByAccount,
		discardPending: gmail.gmailMessageUpdateStore.discardPending,
	});

	const stopMarking = async (input: { userId: UserId; accountEmail: GmailAccountEmail; senderEmail: ForwardableSender; reason: "option-off" | "mapping-removed" }): Promise<void> => {
		const { reason, ...ref } = input;
		await discardPendingForSender(ref);
		await gmail.gmailMarkBackfillStore.cancelBackfill({ ...ref, generation: undefined, reason, now: now() });
	};

	const senderRequest = async (req: Request, res: Response): Promise<{
		ref: { userId: UserId; accountEmail: GmailAccountEmail; senderEmail: ForwardableSender };
		state: GmailPickerState;
		connection: GmailConnection;
	} | undefined> => {
		const userId = ownerOf(req);
		const state = listState(req.body);
		const body = SenderBodySchema.safeParse(req.body);
		if (!body.success) {
			redirectTo(res, state, { error: "sender_invalid" });
			return undefined;
		}
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		assert(connection, "the connected middleware requires a Gmail connection");
		if (connection.accountEmail === undefined) {
			redirectTo(res, state);
			return undefined;
		}
		return { ref: { userId, accountEmail: connection.accountEmail, senderEmail: body.data.sender }, state, connection };
	};

	router.post("/gmail/readlists/create", write, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const state = parseGmailPickerState(req.body);
		const outcome = await gmail.upsertReadlist({ userId, name: state.readlist_name ?? "" });
		switch (outcome.status) {
			case "ok":
				redirectTo(res, confirmGmailReadlists({ ...state, readlist_name: undefined, readlist: [...new Set([...gmailSelectedReadlists(state), outcome.readlist.slug])] }), {
					notice: outcome.created ? "readlist_created" : "readlist_reused",
				});
				return;
			case "reserved-name":
				redirectTo(res, confirmGmailReadlists({ ...state, readlist_name: undefined, readlist: [...new Set([...gmailSelectedReadlists(state), outcome.readlist.slug])] }), { notice: "readlist_reused" });
				return;
			case "invalid-name":
				redirectTo(res, state, { error: "readlist_name_invalid" });
				return;
			case "limit-reached":
				redirectTo(res, state, { error: "readlist_limit" });
				return;
		}
	});

	router.post("/gmail/senders/remove", teardown, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const state = listState(req.body);
		const body = SenderBodySchema.safeParse(req.body);
		if (!body.success) {
			redirectTo(res, state, { error: "sender_invalid" });
			return;
		}
		const senderEmail = body.data.sender;
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		assert(connection, "the connected middleware requires a Gmail connection");
		if (connection.accountEmail !== undefined) {
			await gmail.gmailMappingStore.removeMapping({ userId, accountEmail: connection.accountEmail, senderEmail });
		}
		await gmail.gmailSenderStore.removeSender({ userId, senderEmail });
		await gmail.publishRewriteGmailFilter({ userId, reason: "sender-removed" });
		await gmail.cancelGmailHistoryImports({ userId, senderEmail, reason: "mapping-removed" });
		if (connection.accountEmail !== undefined) {
			await stopMarking({ userId, accountEmail: connection.accountEmail, senderEmail, reason: "mapping-removed" });
		}
		redirectTo(res, state, { notice: "sender_removed" });
	});

	router.post("/gmail/imports/start", write, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const state = listState(req.body);
		const body = SenderBodySchema.safeParse(req.body);
		if (!body.success) {
			redirectTo(res, state, { error: "sender_invalid" });
			return;
		}
		const sender = body.data.sender;
		const connection = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		assert(connection, "the connected middleware requires a Gmail connection");
		const accountEmail = connection.accountEmail;
		if (accountEmail === undefined) {
			redirectTo(res, state, { error: "import_reconnect_required" });
			return;
		}
		const row = await gmail.gmailMappingStore.findMapping({ userId, accountEmail, senderEmail: sender });
		const destinations = await readlistDestinations({ userId, row });
		if (destinations === undefined) {
			redirectTo(res, state, { error: "import_unavailable" });
			return;
		}
		const outcome = await imports.start({ userId, sender, destinations, connection: { ...connection, accountEmail } });
		redirectTo(res, state, outcome.ok ? { notice: outcome.notice } : { error: outcome.error });
	});

	router.post("/gmail/imports/retry", write, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const state = parseGmailPickerState(req.body);
		const body = JobBodySchema.safeParse(req.body);
		const job = body.success ? await gmail.gmailHistoryImportStore.findJob({ userId, jobId: body.data.job }) : undefined;
		if (job === undefined) {
			redirectTo(res, state);
			return;
		}
		const [mapping, connection] = await Promise.all([
			gmail.gmailMappingStore.findMapping({ userId, accountEmail: job.connection.accountEmail, senderEmail: job.senderEmail }),
			gmail.gmailConnectionStore.findConnectionByUserId(userId),
		]);
		assert(connection, "the connected middleware requires a Gmail connection");
		if (!importFollowsMapping({ job, mapping, connection })) {
			redirectTo(res, state, { error: "import_unavailable" });
			return;
		}
		if (connection.revokedAt !== undefined) {
			redirectTo(res, state, { error: "import_revoked" });
			return;
		}
		if (!(await imports.readGranted(userId))) {
			redirectTo(res, state, { notice: "import_permission_needed" });
			return;
		}
		const resumed = await imports.resume({ userId, jobId: job.jobId });
		redirectTo(res, state, resumed ? { notice: "import_started" } : {});
	});

	router.post("/gmail/imports/cancel", teardown, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const state = parseGmailPickerState(req.body);
		const body = JobBodySchema.safeParse(req.body);
		const job = body.success ? await gmail.gmailHistoryImportStore.findJob({ userId, jobId: body.data.job }) : undefined;
		if (job === undefined || !UNFINISHED_IMPORT_STATES.has(job.state)) {
			redirectTo(res, state);
			return;
		}
		await gmail.cancelGmailHistoryImports({ userId, senderEmail: job.senderEmail, reason: "user-cancelled" });
		redirectTo(res, state, { notice: "import_cancelled" });
	});

	router.post("/gmail/mark-read/start", write, connected, async (req: Request, res: Response) => {
		const request = await senderRequest(req, res);
		if (request === undefined) return;
		const { ref, state, connection } = request;
		if (OptionBoxSchema.parse(req.body).option !== "on" || (await mappedNewsletter(ref)) === undefined) {
			redirectTo(res, state);
			return;
		}
		if (await imports.modifyGranted(ref.userId)) {
			await gmail.gmailMappingStore.setMarkImported(ref);
			redirectTo(res, state, { notice: "mark_on" });
			return;
		}
		if (connection.revokedAt !== undefined) {
			redirectTo(res, state, { error: "mark_revoked" });
			return;
		}
		const outcome = await consent.beginMarkConsent({ req, res, route: "mark", userId: ref.userId, senders: [ref.senderEmail], state });
		if (outcome === "no-access") redirectTo(res, state);
		if (outcome === "state-too-large") redirectTo(res, state, { notice: "mark_permission_needed" });
	});

	router.post("/gmail/mark-read/stop", teardown, connected, async (req: Request, res: Response) => {
		const request = await senderRequest(req, res);
		if (request === undefined) return;
		const { ref, state } = request;
		if (OptionBoxSchema.parse(req.body).option === "on") {
			redirectTo(res, state);
			return;
		}
		await gmail.gmailMappingStore.clearMarkImported(ref);
		await stopMarking({ ...ref, reason: "option-off" });
		redirectTo(res, state, { notice: "mark_off" });
	});

	router.post("/gmail/mark-read/backfill", write, connected, async (req: Request, res: Response) => {
		const request = await senderRequest(req, res);
		if (request === undefined) return;
		const { ref, state } = request;
		const row = await gmail.gmailMappingStore.findMapping(ref);
		const optionEnabledAt = row?.markImportedAt;
		if (optionEnabledAt === undefined) {
			redirectTo(res, state);
			return;
		}
		if (!(await imports.modifyGranted(ref.userId))) {
			redirectTo(res, state, { notice: "mark_permission_needed" });
			return;
		}
		const start = await gmail.gmailMarkBackfillStore.startBackfill({ ...ref, optionEnabledAt, now: now() });
		if (start.started) await gmail.publishStartGmailMarkBackfill({ ...ref, generation: start.job.generation });
		redirectTo(res, state, { notice: "mark_backfill_started" });
	});
}
