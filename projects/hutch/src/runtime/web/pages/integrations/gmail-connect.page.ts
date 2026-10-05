import assert from "node:assert";
import { randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { sendComponent } from "@packages/web-shell";
import { baseCookieOptions } from "@packages/web-analytics";
import { ForwardableSenderSchema, hasGmailScope, summarizeGmailHistoryImport } from "@packages/domain/gmail";
import type { ForwardableSender, GmailConnection, GmailHistoryImportSummary } from "@packages/domain/gmail";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { GMAIL_READONLY_SCOPE, GMAIL_SCOPES } from "@packages/provider-contracts/gmail-oauth";
import type { GetEffectiveAccess } from "@packages/subscription-access";
import { initRecordGmailDiagnostic } from "../../../observability/gmail-diagnostics";
import { HxRedirectPage } from "../../hx-redirect-page";
import { signState, verifyState } from "../../auth/oauth-state";
import { buildIntegrationsUrl, GMAIL_CALLBACK_PATH } from "./gmail-connect.url";
import { buildGmailUrl, GmailPickerStateSchema, parseGmailPickerState } from "./gmail.url";
import { importFollowsMapping, initGmailImportActions, latestGmailImportsBySender } from "./gmail-import-actions";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";
import {
	fingerprintGmailOAuthState,
	initGmailOAuthTrace,
	initReadGmailOAuthState,
	inspectGmailOAuthCallback,
	toGmailOAuthStateInspection,
} from "./gmail-oauth-diagnostics";
import { initRequireGmailConnectionAccess } from "./require-gmail-connection-access";

const STATE_COOKIE = "hutch_gmail_state";
const STATE_TTL_MS = 5 * 60 * 1000;

const CallbackQuerySchema = z.object({ code: z.string(), state: z.string() });
const ConnectIntentSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("connect") }),
	z.object({ kind: z.literal("import"), sender: ForwardableSenderSchema, state: GmailPickerStateSchema }),
]);
type ConnectIntent = z.infer<typeof ConnectIntentSchema>;
const StatePayloadSchema = z.object({ nonce: z.string(), createdAt: z.number(), intent: ConnectIntentSchema });
const ImportIntentBodySchema = z.object({ intent: z.literal("import"), sender: ForwardableSenderSchema });
const RETRYABLE_IMPORT_STATUSES: ReadonlySet<GmailHistoryImportSummary["status"]> = new Set(["failed", "partial-failure"]);

export interface GmailConnectContext {
	appOrigin: string;
	secureCookies: boolean;
	logError: (message: string, error?: Error) => void;
	now: () => Date;
	requireAuth: RequestHandler;
	requireNotLocked: RequestHandler;
	requireWriteAccess: RequestHandler;
	getEffectiveAccess: GetEffectiveAccess;
}

export function registerGmailConnectRoutes(
	routers: { router: Router; callbackRouter: Router },
	gmail: GmailIntegrationDependencies,
	context: GmailConnectContext,
): void {
	const { router, callbackRouter } = routers;
	const redirectUri = `${context.appOrigin}${GMAIL_CALLBACK_PATH}`;
	const requireGmailConnectionAccess = initRequireGmailConnectionAccess({ getEffectiveAccess: context.getEffectiveAccess });
	const trace = initGmailOAuthTrace({
		record: initRecordGmailDiagnostic({ logger: gmail.diagnosticsLogger, now: context.now }),
		now: context.now,
		appOrigin: context.appOrigin,
	});
	const readState = initReadGmailOAuthState({
		secret: gmail.stateSecret,
		parsePayload: (json) => StatePayloadSchema.safeParse(json).data,
	});
	const write = [
		trace.guard({ stage: "requireAuth", handler: context.requireAuth }),
		trace.guard({ stage: "requireNotLocked", handler: context.requireNotLocked }),
		trace.guard({ stage: "requireGmailConnectionAccess", handler: requireGmailConnectionAccess }),
		trace.guard({ stage: "requireWriteAccess", handler: context.requireWriteAccess }),
	];
	const imports = initGmailImportActions({ gmail, now: context.now });

	const verifiedPayload = (stateCookie: unknown): z.infer<typeof StatePayloadSchema> | undefined => {
		if (typeof stateCookie !== "string") return undefined;
		const verified = verifyState({ signed: stateCookie, secret: gmail.stateSecret });
		if (verified === null) return undefined;
		const payload = StatePayloadSchema.safeParse(JSON.parse(verified));
		return payload.success ? payload.data : undefined;
	};

	const resumeImports = async (input: { userId: UserId; sender: ForwardableSender }): Promise<number> => {
		const [jobs, mapping] = await Promise.all([
			gmail.gmailHistoryImportStore.listJobsByUserId(input.userId),
			gmail.gmailSenderStore.findSender({ userId: input.userId, senderEmail: input.sender }),
		]);
		const latest = latestGmailImportsBySender(jobs).get(input.sender);
		const retry = latest !== undefined
			&& RETRYABLE_IMPORT_STATUSES.has(summarizeGmailHistoryImport(latest).status)
			&& importFollowsMapping({ job: latest, mapping });
		const resumable = [...jobs.filter((job) => job.state === "awaiting-permission"), ...(retry ? [latest] : [])];
		const resumed = await Promise.all(resumable.map((job) => imports.resume({ userId: input.userId, jobId: job.jobId })));
		return resumed.filter(Boolean).length;
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
		const { sender: _picked, edit: _edit, ...state } = GmailPickerStateSchema.parse(parseGmailPickerState(req.body));
		const intent: ConnectIntent = importBody.success
			? { kind: "import", sender: importBody.data.sender, state }
			: { kind: "connect" };
		trace.enter(req, "issue-state");
		const previousCookie = toGmailOAuthStateInspection(
			readState({ value: req.cookies?.[STATE_COOKIE], checkedAtMs: context.now().getTime() }),
		);
		const statePayload = JSON.stringify({
			nonce: randomBytes(16).toString("hex"),
			createdAt: context.now().getTime(),
			intent,
		});
		const signedState = signState({ payload: statePayload, secret: gmail.stateSecret });
		trace.record(req, {
			event: "gmail.oauth.state.issued",
			level: "INFO",
			issuedStateFingerprint: fingerprintGmailOAuthState(signedState),
			previousCookie,
			intentKind: intent.kind,
		});

		res.cookie(STATE_COOKIE, signedState, {
			...baseCookieOptions(context.secureCookies),
			maxAge: STATE_TTL_MS,
		});

		const params = new URLSearchParams({
			client_id: gmail.clientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: intent.kind === "import" ? GMAIL_READONLY_SCOPE : GMAIL_SCOPES,
			// Google issues a refresh token only for an offline grant, and re-issues
			// one only when consent is forced; without both, a reconnect returns an
			// access token with nothing to renew it.
			access_type: "offline",
			prompt: "consent",
			state: signedState,
		});
		if (intent.kind === "import") params.set("include_granted_scopes", "true");
		trace.enter(req, "find-connection");
		const existing = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		if (existing?.accountEmail !== undefined) params.set("login_hint", existing.accountEmail);

		trace.enter(req, "done");
		const authorizeUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
		if (req.get("HX-Request") === "true") {
			sendComponent(req, res, HxRedirectPage(authorizeUrl));
			return;
		}
		res.redirect(303, authorizeUrl);
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
		const stateCookie = req.cookies?.[STATE_COOKIE];
		res.clearCookie(STATE_COOKIE, { path: "/" });

		trace.enter(req, "state-check");
		const checkedAtMs = context.now().getTime();
		trace.record(req, inspectGmailOAuthCallback({
			query: req.query,
			queryShape: CallbackQuerySchema.safeParse(req.query).success ? "valid" : "malformed",
			stateCookie,
			checkedAtMs,
			ttlMs: STATE_TTL_MS,
			readState,
		}));
		const payload = verifiedPayload(stateCookie);
		if (typeof req.query.error === "string") {
			trace.enter(req, "provider-error");
			const destination = payload?.intent.kind === "import"
				? buildGmailUrl({ ...payload.intent.state, notice: "import_permission_refused" })
				: buildIntegrationsUrl({ error: "oauth_denied" });
			res.redirect(303, destination);
			return;
		}

		const parsedQuery = CallbackQuerySchema.safeParse(req.query);
		if (!parsedQuery.success || payload === undefined || parsedQuery.data.state !== stateCookie) {
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_state" }));
			return;
		}
		if (checkedAtMs - payload.createdAt > STATE_TTL_MS) {
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

		if (existing === undefined) {
			trace.enter(req, "create-connection");
			await gmail.gmailConnectionStore.createConnection({
				userId,
				gatewayAddress: await gmail.mintGatewayAddress({ userId }),
			});
		}

		trace.enter(req, "record-account-email");
		await gmail.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: found.value });
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
			if (!hasGmailScope({ grantedScope: grant.grant.grantedScope, scope: GMAIL_READONLY_SCOPE })) {
				res.redirect(303, buildGmailUrl({ ...state, notice: "import_permission_refused" }));
				return;
			}
			const resumed = await resumeImports({ userId, sender: payload.intent.sender });
			trace.enter(req, "done");
			res.redirect(303, buildGmailUrl({ ...state, notice: resumed > 0 ? "import_started" : "import_permission_granted" }));
			return;
		}
		trace.enter(req, "done");
		res.redirect(303, buildGmailUrl({ notice: "connected" }));
	});
}
