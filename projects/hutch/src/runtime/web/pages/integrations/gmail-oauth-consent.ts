import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { sendComponent } from "@packages/web-shell";
import { baseCookieOptions } from "@packages/web-analytics";
import type { ForwardableSender } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import { GMAIL_MODIFY_SCOPE, GMAIL_READONLY_SCOPE, GMAIL_SCOPES } from "@packages/provider-contracts/gmail-oauth";
import type { GetEffectiveAccess } from "@packages/subscription-access";
import { initRecordGmailDiagnostic } from "../../../observability/gmail-diagnostics";
import { HxRedirectPage } from "../../hx-redirect-page";
import { signState, verifyState } from "../../auth/oauth-state";
import { GMAIL_CALLBACK_PATH } from "./gmail-connect.url";
import { canConnectGmail } from "./gmail-connection-access";
import type { GmailPickerState } from "./gmail.url";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";
import {
	fingerprintGmailOAuthState,
	type GmailOAuthTrace,
	initGmailOAuthTrace,
	initReadGmailOAuthState,
	toGmailOAuthStateInspection,
} from "./gmail-oauth-diagnostics";
import { type ConnectIntent, type StatePayload, StatePayloadSchema } from "./gmail-oauth-intent";

export const GMAIL_OAUTH_STATE_COOKIE = "hutch_gmail_state";
export const GMAIL_OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
export const GMAIL_OAUTH_STATE_COOKIE_BUDGET = 3_800;

const REQUESTED_SCOPES: Record<ConnectIntent["kind"], string> = {
	connect: GMAIL_SCOPES,
	import: GMAIL_READONLY_SCOPE,
	mark: GMAIL_MODIFY_SCOPE,
};

export type GmailMarkConsentOutcome = "redirected" | "no-access" | "state-too-large";

export interface GmailOAuthConsent {
	trace: GmailOAuthTrace;
	readState: ReturnType<typeof initReadGmailOAuthState>;
	verifiedPayload: (stateCookie: unknown) => StatePayload | undefined;
	begin: (input: { req: Request; res: Response; userId: UserId; intent: ConnectIntent }) => Promise<void>;
	beginMarkConsent: (input: {
		req: Request;
		res: Response;
		route: "save" | "mark";
		userId: UserId;
		senders: readonly ForwardableSender[];
		state: GmailPickerState;
	}) => Promise<GmailMarkConsentOutcome>;
}

export function initGmailOAuthConsent(deps: {
	gmail: Pick<GmailIntegrationDependencies, "clientId" | "stateSecret" | "gmailConnectionStore" | "diagnosticsLogger">;
	appOrigin: string;
	secureCookies: boolean;
	now: () => Date;
	getEffectiveAccess: GetEffectiveAccess;
}): GmailOAuthConsent {
	const { gmail } = deps;
	const redirectUri = `${deps.appOrigin}${GMAIL_CALLBACK_PATH}`;
	const trace = initGmailOAuthTrace({
		record: initRecordGmailDiagnostic({ logger: gmail.diagnosticsLogger, now: deps.now }),
		now: deps.now,
		appOrigin: deps.appOrigin,
	});
	const readState = initReadGmailOAuthState({
		secret: gmail.stateSecret,
		parsePayload: (json) => StatePayloadSchema.safeParse(json).data,
	});

	const verifiedPayload = (stateCookie: unknown): StatePayload | undefined => {
		if (typeof stateCookie !== "string") return undefined;
		const verified = verifyState({ signed: stateCookie, secret: gmail.stateSecret });
		if (verified === null) return undefined;
		const payload = StatePayloadSchema.safeParse(JSON.parse(verified));
		return payload.success ? payload.data : undefined;
	};

	const sign = (req: Request, intent: ConnectIntent) => {
		trace.enter(req, "issue-state");
		const previousCookie = toGmailOAuthStateInspection(
			readState({ value: req.cookies?.[GMAIL_OAUTH_STATE_COOKIE], checkedAtMs: deps.now().getTime() }),
		);
		const statePayload = JSON.stringify({
			nonce: randomBytes(16).toString("hex"),
			createdAt: deps.now().getTime(),
			intent,
		});
		return { intent, previousCookie, signedState: signState({ payload: statePayload, secret: gmail.stateSecret }) };
	};

	const send = async (input: { req: Request; res: Response; userId: UserId; signed: ReturnType<typeof sign> }): Promise<void> => {
		const { req, res, signed } = input;
		const { intent, previousCookie, signedState } = signed;
		trace.record(req, {
			event: "gmail.oauth.state.issued",
			level: "INFO",
			issuedStateFingerprint: fingerprintGmailOAuthState(signedState),
			previousCookie,
			intentKind: intent.kind,
		});

		res.cookie(GMAIL_OAUTH_STATE_COOKIE, signedState, {
			...baseCookieOptions(deps.secureCookies),
			maxAge: GMAIL_OAUTH_STATE_TTL_MS,
		});

		const params = new URLSearchParams({
			client_id: gmail.clientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: REQUESTED_SCOPES[intent.kind],
			// Google issues a refresh token only for an offline grant, and re-issues
			// one only when consent is forced; without both, a reconnect returns an
			// access token with nothing to renew it.
			access_type: "offline",
			prompt: "consent",
			state: signedState,
		});
		if (intent.kind !== "connect") params.set("include_granted_scopes", "true");
		trace.enter(req, "find-connection");
		const existing = await gmail.gmailConnectionStore.findConnectionByUserId(input.userId);
		if (existing?.accountEmail !== undefined) params.set("login_hint", existing.accountEmail);

		trace.enter(req, "done");
		const authorizeUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
		if (req.get("HX-Request") === "true") {
			sendComponent(req, res, HxRedirectPage(authorizeUrl));
			return;
		}
		res.redirect(303, authorizeUrl);
	};

	return {
		trace,
		readState,
		verifiedPayload,
		begin: ({ req, res, userId, intent }) => send({ req, res, userId, signed: sign(req, intent) }),
		beginMarkConsent: async ({ req, res, route, userId, senders, state }) => {
			if (!canConnectGmail(await deps.getEffectiveAccess(userId))) return "no-access";
			trace.open({ route, req, res });
			const signed = sign(req, { kind: "mark", senders, state });
			if (encodeURIComponent(signed.signedState).length > GMAIL_OAUTH_STATE_COOKIE_BUDGET) return "state-too-large";
			await send({ req, res, userId, signed });
			return "redirected";
		},
	};
}
