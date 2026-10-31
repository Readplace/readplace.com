import assert from "node:assert";
import { randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { hasAnyGmailScope, hasGmailScope, summarizeGmailHistoryImport } from "@packages/domain/gmail";
import type { ForwardableSender, GmailAccountEmail, GmailConnection, GmailHistoryImportJob, GmailHistoryImportSummary } from "@packages/domain/gmail";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { GMAIL_MESSAGE_READ_SCOPES, GMAIL_MODIFY_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { GetEffectiveAccess } from "@packages/subscription-access";
import { buildIntegrationsUrl, GMAIL_CALLBACK_PATH } from "./gmail-connect.url";
import { buildGmailUrl, closeGmailDialog, parseGmailPickerState } from "./gmail.url";
import { importFollowsMapping, initGmailImportActions, latestGmailImportsBySender } from "./gmail-import-actions";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";
import { initGmailMarkActions } from "./gmail-mark-actions";
import { inspectGmailOAuthCallback } from "./gmail-oauth-diagnostics";
import { GMAIL_OAUTH_STATE_COOKIE, GMAIL_OAUTH_STATE_TTL_MS, type GmailOAuthConsent } from "./gmail-oauth-consent";
import { type ConnectIntent, ImportIntentBodySchema, MarkIntentBodySchema } from "./gmail-oauth-intent";
import { initRequireGmailConnectionAccess } from "./require-gmail-connection-access";

const CallbackQuerySchema = z.object({ code: z.string(), state: z.string() });
const RETRYABLE_IMPORT_STATUSES: ReadonlySet<GmailHistoryImportSummary["status"]> = new Set(["failed", "partial-failure"]);

export interface GmailConnectContext {
	logError: (message: string, error?: Error) => void;
	now: () => Date;
	requireAuth: RequestHandler;
	requireNotLocked: RequestHandler;
	requireWriteAccess: RequestHandler;
	getEffectiveAccess: GetEffectiveAccess;
	consent: GmailOAuthConsent;
}

export function registerGmailConnectRoutes(
	routers: { router: Router; callbackRouter: Router },
	gmail: GmailIntegrationDependencies,
	context: GmailConnectContext,
): void {
	const { router, callbackRouter } = routers;
	const { trace, readState, verifiedPayload } = context.consent;
	const requireGmailConnectionAccess = initRequireGmailConnectionAccess({ getEffectiveAccess: context.getEffectiveAccess });
	const write = [
		trace.guard({ stage: "requireAuth", handler: context.requireAuth }),
		trace.guard({ stage: "requireNotLocked", handler: context.requireNotLocked }),
		trace.guard({ stage: "requireGmailConnectionAccess", handler: requireGmailConnectionAccess }),
		trace.guard({ stage: "requireWriteAccess", handler: context.requireWriteAccess }),
	];
	const imports = initGmailImportActions({ gmail, now: context.now });
	const { turnOnMapped } = initGmailMarkActions({ gmail });

	const resumeAll = async (jobs: GmailHistoryImportJob[], userId: UserId): Promise<number> => {
		const resumed = await Promise.all(jobs.map((job) => imports.resume({ userId, jobId: job.jobId })));
		return resumed.filter(Boolean).length;
	};

	const resumeAwaitingImports = async (userId: UserId): Promise<number> => {
		const jobs = await gmail.gmailHistoryImportStore.listJobsByUserId(userId);
		return resumeAll(jobs.filter((job) => job.state === "awaiting-permission"), userId);
	};

	const resumeSenderImports = async (input: { userId: UserId; accountEmail: GmailAccountEmail; sender: ForwardableSender }): Promise<number> => {
		const [jobs, mapping, connection] = await Promise.all([
			gmail.gmailHistoryImportStore.listJobsByUserId(input.userId),
			gmail.gmailMappingStore.findMapping({ userId: input.userId, accountEmail: input.accountEmail, senderEmail: input.sender }),
			gmail.gmailConnectionStore.findConnectionByUserId(input.userId),
		]);
		assert(connection, "a completed Gmail callback leaves a connection");
		const latest = latestGmailImportsBySender(jobs).get(input.sender);
		const retry = latest !== undefined
			&& RETRYABLE_IMPORT_STATUSES.has(summarizeGmailHistoryImport(latest).status)
			&& importFollowsMapping({ job: latest, mapping, connection });
		return resumeAll([...jobs.filter((job) => job.state === "awaiting-permission"), ...(retry ? [latest] : [])], input.userId);
	};

	const reconnectRequired = async (input: { intent: ConnectIntent; existing: GmailConnection; userId: UserId }): Promise<boolean> => {
		if (input.intent.kind === "connect" || input.existing.revokedAt !== undefined) return true;
		const discovery = await gmail.gmailDiscoveryStore.findDiscoveryByUserId(input.userId);
		return discovery?.requiresReconnect === true;
	};

	const returnSignedOutReaderToIntegrations: RequestHandler = (req, res, next) => {
		if (req.userId) {
			next();
			return;
		}
		const returnPath = buildIntegrationsUrl({ error: "oauth_signed_out" });
		res.redirect(303, `/login?return=${encodeURIComponent(returnPath)}`);
	};

	router.post("/gmail/connect", [trace.begin("connect"), ...write], async (req: Request, res: Response) => {
		trace.enter(req, "handler");
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = UserIdSchema.parse(req.userId);
		const importBody = ImportIntentBodySchema.safeParse(req.body);
		const markBody = MarkIntentBodySchema.safeParse(req.body);
		const { sender: _picked, ...state } = closeGmailDialog(parseGmailPickerState(req.body));
		const intent: ConnectIntent = importBody.success
			? { kind: "import", sender: importBody.data.sender, state }
			: markBody.success
				? { kind: "mark", senders: [markBody.data.sender], state }
				: { kind: "connect" };
		await context.consent.begin({ req, res, userId, intent });
	});

	const callbackGuards = [
		trace.begin("callback"),
		trace.guard({ stage: "returnSignedOutReader", handler: returnSignedOutReaderToIntegrations }),
		...write,
	];

	callbackRouter.get(GMAIL_CALLBACK_PATH, callbackGuards, async (req: Request, res: Response) => {
		trace.enter(req, "handler");
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = UserIdSchema.parse(req.userId);
		const stateCookie = req.cookies?.[GMAIL_OAUTH_STATE_COOKIE];
		res.clearCookie(GMAIL_OAUTH_STATE_COOKIE, { path: "/" });

		trace.enter(req, "state-check");
		const checkedAtMs = context.now().getTime();
		trace.record(req, inspectGmailOAuthCallback({
			query: req.query,
			queryShape: CallbackQuerySchema.safeParse(req.query).success ? "valid" : "malformed",
			stateCookie,
			checkedAtMs,
			ttlMs: GMAIL_OAUTH_STATE_TTL_MS,
			readState,
		}));
		const payload = verifiedPayload(stateCookie);
		if (typeof req.query.error === "string") {
			trace.enter(req, "provider-error");
			const destination = payload?.intent.kind === "import"
				? buildGmailUrl({ ...payload.intent.state, notice: "import_permission_refused" })
				: payload?.intent.kind === "mark"
					? buildGmailUrl({ ...payload.intent.state, notice: "mark_permission_refused" })
					: buildIntegrationsUrl({ error: "oauth_denied" });
			res.redirect(303, destination);
			return;
		}

		const parsedQuery = CallbackQuerySchema.safeParse(req.query);
		if (!parsedQuery.success || payload === undefined || parsedQuery.data.state !== stateCookie) {
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_state" }));
			return;
		}
		if (checkedAtMs - payload.createdAt > GMAIL_OAUTH_STATE_TTL_MS) {
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_state" }));
			return;
		}

		trace.enter(req, "find-connection");
		const existing = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		trace.enter(req, "exchange");
		const grant = await gmail.exchangeGmailCode({ code: parsedQuery.data.code });
		if (!grant.ok) {
			trace.fail(req, grant.reason);
			if (grant.reason === "metadata-scope-not-granted") {
				res.redirect(303, buildIntegrationsUrl({
					error: existing === undefined ? "oauth_metadata_scope_first_connect" : "oauth_metadata_scope",
				}));
				return;
			}
			if (grant.reason === "scope-not-granted") {
				res.redirect(303, buildIntegrationsUrl({ error: "oauth_scope" }));
				return;
			}
			const { ok: _ok, ...failure } = grant;
			context.logError(`[gmail-connect] grant unusable: ${JSON.stringify(failure)}`);
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_exchange" }));
			return;
		}

		trace.enter(req, "account-email");
		const found = await gmail.findGmailAccountEmail({ accessToken: grant.grant.accessToken });
		if (!found.ok) {
			trace.fail(req, found.reason);
			context.logError(`[gmail-connect] account email unavailable: ${found.reason}`);
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_exchange" }));
			return;
		}
		trace.enter(req, "account-check");
		if (existing !== undefined && existing.accountEmail?.trim().toLowerCase() !== found.value.trim().toLowerCase()) {
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_account_changed" }));
			return;
		}
		trace.enter(req, "save-credentials");
		await gmail.gmailCredentialsStore.saveCredentials({
			userId,
			refreshToken: grant.grant.refreshToken,
			grantedScope: grant.grant.grantedScope,
		});

		let created: GmailConnection | undefined;
		if (existing === undefined) {
			trace.enter(req, "create-connection");
			created = await gmail.gmailConnectionStore.createConnection({
				userId,
				gatewayAddress: await gmail.mintGatewayAddress({ userId }),
			});
		}

		trace.enter(req, "record-account-email");
		await gmail.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: found.value });
		const modifyGranted = hasGmailScope({ grantedScope: grant.grant.grantedScope, scope: GMAIL_MODIFY_SCOPE });
		if (modifyGranted) {
			await gmail.publishGmailModifyPermissionGranted({ userId, accountEmail: found.value });
		}
		if (created?.forwardingConfirmedAt !== undefined) {
			await gmail.publishRewriteGmailFilter({ userId, reason: "reconnected" });
		}
		trace.enter(req, "reconnect");
		if (existing !== undefined && await reconnectRequired({ intent: payload.intent, existing, userId })) {
			const connectedAt = await gmail.gmailConnectionStore.clearRevoked({ userId });
			try {
				await gmail.gmailDiscoveryStore.clearRequiresReconnect({ userId, generation: randomBytes(16).toString("hex") });
				if (existing.revokedAt !== undefined) {
					await gmail.publishRewriteGmailFilter({ userId, reason: "reconnected" });
				}
			} catch (error) {
				if (existing.revokedAt !== undefined) {
					await gmail.gmailConnectionStore.markRevokedIfCurrent({
						userId,
						gatewayAddress: existing.gatewayAddress,
						connectedAt,
						reason: "invalid-grant",
					});
				}
				throw error;
			}
		}
		if (payload.intent.kind === "import") {
			trace.enter(req, "import-intent");
			const state = payload.intent.state;
			if (!hasAnyGmailScope({ grantedScope: grant.grant.grantedScope, scopes: GMAIL_MESSAGE_READ_SCOPES })) {
				res.redirect(303, buildGmailUrl({ ...state, notice: "import_permission_refused" }));
				return;
			}
			const resumed = await resumeSenderImports({ userId, accountEmail: found.value, sender: payload.intent.sender });
			trace.enter(req, "done");
			res.redirect(303, buildGmailUrl({ ...state, notice: resumed > 0 ? "import_started" : "import_permission_granted" }));
			return;
		}
		if (payload.intent.kind === "mark") {
			trace.enter(req, "mark-intent");
			const state = payload.intent.state;
			if (!modifyGranted) {
				res.redirect(303, buildGmailUrl({ ...state, notice: "mark_permission_refused" }));
				return;
			}
			for (const senderEmail of payload.intent.senders) await turnOnMapped({ userId, accountEmail: found.value, senderEmail });
			await resumeAwaitingImports(userId);
			trace.enter(req, "done");
			res.redirect(303, buildGmailUrl({ ...state, notice: "mark_permission_granted" }));
			return;
		}
		trace.enter(req, "done");
		res.redirect(303, buildGmailUrl({ notice: "connected" }));
	});
}
