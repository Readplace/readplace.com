import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { ForwardableSenderSchema, GmailHistoryImportJobIdSchema } from "@packages/domain/gmail";
import { isLiveAddress } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { type GmailImportActions, importFollowsMapping, UNFINISHED_IMPORT_STATES } from "./gmail-import-actions";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";
import { buildGmailUrl, type GmailPageError, type GmailPageNotice, type GmailPickerState, parseGmailPickerState } from "./gmail.url";

const SenderBodySchema = z.object({ sender: ForwardableSenderSchema });
const JobBodySchema = z.object({ job: GmailHistoryImportJobIdSchema });

export interface GmailMappingRoutesContext {
	write: RequestHandler[];
	teardown: RequestHandler[];
	connected: RequestHandler;
	ownerOf: (req: Request) => UserId;
	imports: GmailImportActions;
}

function listState(body: unknown): GmailPickerState {
	const { sender: _sender, edit: _edit, ...state } = parseGmailPickerState(body);
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
	const { write, teardown, connected, ownerOf, imports } = context;

	router.post("/gmail/readlists/create", write, connected, async (req: Request, res: Response) => {
		const userId = ownerOf(req);
		const state = parseGmailPickerState(req.body);
		const outcome = await gmail.upsertReadlist({ userId, name: state.readlist_name ?? "" });
		switch (outcome.status) {
			case "ok":
				redirectTo(res, { ...state, readlist_name: undefined, edit: undefined, readlist: outcome.readlist.slug }, {
					notice: outcome.created ? "readlist_created" : "readlist_reused",
				});
				return;
			case "reserved-name":
				redirectTo(res, { ...state, readlist_name: undefined, edit: undefined, readlist: outcome.readlist.slug }, { notice: "readlist_reused" });
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
		await gmail.gmailSenderStore.removeSender({ userId, senderEmail });
		await gmail.publishRewriteGmailFilter({ userId, reason: "sender-removed" });
		await gmail.cancelGmailHistoryImports({ userId, senderEmail, reason: "mapping-removed" });
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
		const [row, connection] = await Promise.all([
			gmail.gmailSenderStore.findSender({ userId, senderEmail: sender }),
			gmail.gmailConnectionStore.findConnectionByUserId(userId),
		]);
		assert(connection, "the connected middleware requires a Gmail connection");
		const destination = row?.addedToFilterAt === undefined ? undefined : row.mappedAddress;
		const entry = destination === undefined ? undefined : await gmail.findInboxAddress(destination);
		if (entry === undefined || entry.userId !== userId || !isLiveAddress(entry)) {
			redirectTo(res, state, { error: "import_unavailable" });
			return;
		}
		const outcome = await imports.start({ userId, sender, destination: entry.address, connection });
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
			gmail.gmailSenderStore.findSender({ userId, senderEmail: job.senderEmail }),
			gmail.gmailConnectionStore.findConnectionByUserId(userId),
		]);
		assert(connection, "the connected middleware requires a Gmail connection");
		if (!importFollowsMapping({ job, mapping })) {
			redirectTo(res, state, { error: "import_unavailable" });
			return;
		}
		if (connection.revokedAt !== undefined) {
			redirectTo(res, state, { error: "import_revoked" });
			return;
		}
		if (!(await imports.readonlyGranted(userId))) {
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
}
