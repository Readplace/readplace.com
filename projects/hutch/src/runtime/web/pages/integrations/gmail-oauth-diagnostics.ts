import { createHash, randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { GmailApiFailure } from "@packages/provider-contracts/gmail-filters";
import type { GmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { gatewayRequestIdOf } from "@packages/web-analytics";
import type {
	GmailDiagnosticEvent,
	GmailOAuthCallbackDecision,
	GmailOAuthCorrelation,
	GmailOAuthStateInspection,
	RecordGmailDiagnostic,
} from "../../../observability/gmail-diagnostics";
import { verifyState } from "../../auth/oauth-state";
import { INTEGRATIONS_PATH } from "./gmail-connect.url";
import { GMAIL_PATH } from "./gmail.url";

type GmailOAuthGuardStage =
	| "returnSignedOutReader"
	| "requireAuth"
	| "requireNotLocked"
	| "requireGmailConnectionAccess"
	| "requireWriteAccess";

type GmailOAuthHandlerStage =
	| "handler"
	| "issue-state"
	| "find-connection"
	| "state-check"
	| "provider-error"
	| "exchange"
	| "account-email"
	| "account-check"
	| "save-credentials"
	| "create-connection"
	| "record-account-email"
	| "reconnect"
	| "import-intent"
	| "done";

type GmailOAuthStage = "received" | GmailOAuthGuardStage | GmailOAuthHandlerStage;

type GmailOAuthFailureReason = Extract<GmailGrantResult, { ok: false }>["reason"] | GmailApiFailure["reason"];

type GmailOAuthCompletedEvent = Extract<GmailDiagnosticEvent, { event: "gmail.oauth.request.completed" }>;

type GmailOAuthRedirect = Exclude<GmailOAuthCompletedEvent["redirect"], undefined>;

type GmailOAuthCompletionLevel = GmailOAuthCompletedEvent["level"];

type WithoutCorrelation<TEvent> = TEvent extends unknown ? Omit<TEvent, keyof GmailOAuthCorrelation> : never;

type GmailOAuthHandlerFields = WithoutCorrelation<
	Extract<GmailDiagnosticEvent, { event: "gmail.oauth.state.issued" | "gmail.oauth.callback.inspected" }>
>;

type GmailOAuthCallbackInspectedFields = WithoutCorrelation<
	Extract<GmailDiagnosticEvent, { event: "gmail.oauth.callback.inspected" }>
>;

interface GmailOAuthStatePayload {
	createdAt: number;
	intent: { kind: "connect" | "import" };
}

type GmailOAuthStateReading =
	| { kind: "absent" }
	| { kind: "verification-threw"; fingerprint: string }
	| { kind: "invalid-signature"; fingerprint: string }
	| { kind: "malformed-json"; fingerprint: string }
	| { kind: "schema-rejected"; fingerprint: string }
	| { kind: "valid"; fingerprint: string; createdAtMs: number; ageMs: number; intentKind: "connect" | "import" };

type ReadGmailOAuthState = (input: { value: unknown; checkedAtMs: number }) => GmailOAuthStateReading;

const KNOWN_PROVIDER_ERRORS: ReadonlySet<string> = new Set([
	"access_denied",
	"consent_required",
	"interaction_required",
	"login_required",
	"account_selection_required",
	"invalid_request",
	"unauthorized_client",
	"unsupported_response_type",
	"invalid_scope",
	"server_error",
	"temporarily_unavailable",
]);

const OWN_REDIRECTS: ReadonlyMap<string, GmailOAuthRedirect> = new Map<string, GmailOAuthRedirect>([
	["/login", "login"],
	[GMAIL_PATH, "gmail"],
	[INTEGRATIONS_PATH, "integrations"],
]);

const OUTCOME_PATTERN = /^[a-z_]{1,64}$/;

const FAILURE_LEVELS: Readonly<Record<GmailOAuthFailureReason, GmailOAuthCompletionLevel>> = {
	"metadata-scope-not-granted": "INFO",
	"scope-not-granted": "INFO",
	"no-refresh-token": "ERROR",
	"exchange-failed": "ERROR",
	"reauth-required": "ERROR",
	rejected: "ERROR",
	unavailable: "ERROR",
};

const UNVERIFIED = { createdAtMs: undefined, ageMs: undefined, intentKind: undefined } as const;

export function fingerprintGmailOAuthState(signed: string): string {
	return createHash("sha256").update(signed).digest("hex");
}

function verifyWithoutThrowing(input: { signed: string; secret: string }): { threw: true } | { threw: false; payload: string | null } {
	try {
		return { threw: false, payload: verifyState(input) };
	} catch {
		return { threw: true };
	}
}

function parseJsonWithoutThrowing(text: string): { parsed: true; value: unknown } | { parsed: false } {
	try {
		return { parsed: true, value: JSON.parse(text) };
	} catch {
		return { parsed: false };
	}
}

export function initReadGmailOAuthState(deps: {
	secret: string;
	parsePayload: (json: unknown) => GmailOAuthStatePayload | undefined;
}): ReadGmailOAuthState {
	return ({ value, checkedAtMs }) => {
		if (typeof value !== "string" || value === "") return { kind: "absent" };
		const fingerprint = fingerprintGmailOAuthState(value);
		const verification = verifyWithoutThrowing({ signed: value, secret: deps.secret });
		if (verification.threw) return { kind: "verification-threw", fingerprint };
		if (verification.payload === null) return { kind: "invalid-signature", fingerprint };
		const json = parseJsonWithoutThrowing(verification.payload);
		if (!json.parsed) return { kind: "malformed-json", fingerprint };
		const payload = deps.parsePayload(json.value);
		if (payload === undefined) return { kind: "schema-rejected", fingerprint };
		return {
			kind: "valid",
			fingerprint,
			createdAtMs: payload.createdAt,
			ageMs: checkedAtMs - payload.createdAt,
			intentKind: payload.intent.kind,
		};
	};
}

export function toGmailOAuthStateInspection(reading: GmailOAuthStateReading): GmailOAuthStateInspection {
	switch (reading.kind) {
		case "absent":
			return { present: false, fingerprint: undefined, signatureValid: undefined, payload: undefined, ...UNVERIFIED };
		case "verification-threw":
		case "invalid-signature":
			return { present: true, fingerprint: reading.fingerprint, signatureValid: false, payload: undefined, ...UNVERIFIED };
		case "malformed-json":
		case "schema-rejected":
			return { present: true, fingerprint: reading.fingerprint, signatureValid: true, payload: reading.kind, ...UNVERIFIED };
		case "valid":
			return {
				present: true,
				fingerprint: reading.fingerprint,
				signatureValid: true,
				payload: "valid",
				createdAtMs: reading.createdAtMs,
				ageMs: reading.ageMs,
				intentKind: reading.intentKind,
			};
	}
}

function classifyProviderError(error: unknown): string | undefined {
	if (typeof error !== "string") return undefined;
	return KNOWN_PROVIDER_ERRORS.has(error) ? error : "other";
}

function decideCallback(input: {
	cookie: GmailOAuthStateReading;
	providerError: boolean;
	queryShape: "valid" | "malformed";
	statesEqual: boolean;
	ttlMs: number;
}): GmailOAuthCallbackDecision {
	if (input.cookie.kind === "verification-threw") return "invalid-signature";
	if (input.cookie.kind === "malformed-json") return "invalid-payload";
	if (input.providerError) return "provider-error";
	if (input.queryShape === "malformed") return "malformed-query";
	switch (input.cookie.kind) {
		case "absent":
			return "missing-cookie";
		case "invalid-signature":
			return "invalid-signature";
		case "schema-rejected":
			return "invalid-payload";
	}
	if (!input.statesEqual) return "state-mismatch";
	return input.cookie.ageMs > input.ttlMs ? "expired" : "accepted";
}

export function inspectGmailOAuthCallback(input: {
	query: Request["query"];
	queryShape: "valid" | "malformed";
	stateCookie: unknown;
	checkedAtMs: number;
	ttlMs: number;
	readState: ReadGmailOAuthState;
}): GmailOAuthCallbackInspectedFields {
	const queryReading = input.readState({ value: input.query.state, checkedAtMs: input.checkedAtMs });
	const cookieReading = input.readState({ value: input.stateCookie, checkedAtMs: input.checkedAtMs });
	const queryState = toGmailOAuthStateInspection(queryReading);
	const cookieState = toGmailOAuthStateInspection(cookieReading);
	const providerError = classifyProviderError(input.query.error);
	const statesEqual = typeof input.query.state === "string" && input.query.state === input.stateCookie;
	return {
		event: "gmail.oauth.callback.inspected",
		level: "INFO",
		providerError,
		codePresent: typeof input.query.code === "string",
		queryShape: input.queryShape,
		queryState,
		cookieState,
		statesEqual,
		verifiedAgeMs: queryState.ageMs,
		decisionAgeMs: cookieState.ageMs,
		ttlMs: input.ttlMs,
		decision: decideCallback({
			cookie: cookieReading,
			providerError: providerError !== undefined,
			queryShape: input.queryShape,
			statesEqual,
			ttlMs: input.ttlMs,
		}),
	};
}

function outcomeOf(params: URLSearchParams): string | undefined {
	const value = params.get("error") ?? params.get("notice");
	return value !== null && OUTCOME_PATTERN.test(value) ? value : undefined;
}

function classifyGmailOAuthRedirect(input: { target: string | undefined; ownOrigin: string }): {
	redirect: GmailOAuthRedirect | undefined;
	outcome: string | undefined;
} {
	if (input.target === undefined) return { redirect: undefined, outcome: undefined };
	const url = URL.parse(input.target, input.ownOrigin);
	if (url === null) return { redirect: "other", outcome: undefined };
	if (url.hostname === "accounts.google.com") return { redirect: "google-authorize", outcome: undefined };
	if (url.origin !== input.ownOrigin) return { redirect: "other", outcome: undefined };
	return { redirect: OWN_REDIRECTS.get(url.pathname) ?? "other", outcome: outcomeOf(url.searchParams) };
}

function completionLevelOf(input: { status: number; failureReason: GmailOAuthFailureReason | undefined }): GmailOAuthCompletionLevel {
	if (input.status >= 500) return "ERROR";
	return input.failureReason === undefined ? "INFO" : FAILURE_LEVELS[input.failureReason];
}

function redirectTargetOf(res: Response): string | undefined {
	const target = res.getHeader("location") ?? res.getHeader("hx-redirect");
	return typeof target === "string" ? target : undefined;
}

interface GmailOAuthTraceState {
	correlation: GmailOAuthCorrelation;
	startedAtMs: number;
	stage: GmailOAuthStage;
	failureReason: GmailOAuthFailureReason | undefined;
	completed: boolean;
}

interface GmailOAuthTrace {
	begin: (route: GmailOAuthCorrelation["route"]) => RequestHandler;
	guard: (input: { stage: GmailOAuthGuardStage; handler: RequestHandler }) => RequestHandler;
	enter: (req: Request, stage: GmailOAuthHandlerStage) => void;
	fail: (req: Request, reason: GmailOAuthFailureReason) => void;
	record: (req: Request, fields: GmailOAuthHandlerFields) => void;
}

export function initGmailOAuthTrace(deps: { record: RecordGmailDiagnostic; now: () => Date; appOrigin: string }): GmailOAuthTrace {
	const traces = new WeakMap<Request, GmailOAuthTraceState>();
	const ownOrigin = new URL(deps.appOrigin).origin;

	const complete = (input: { state: GmailOAuthTraceState; res: Response; completion: "finished" | "aborted" }): void => {
		if (input.state.completed) return;
		input.state.completed = true;
		try {
			const { redirect, outcome } = classifyGmailOAuthRedirect({ target: redirectTargetOf(input.res), ownOrigin });
			deps.record({
				...input.state.correlation,
				event: "gmail.oauth.request.completed",
				level: completionLevelOf({ status: input.res.statusCode, failureReason: input.state.failureReason }),
				completion: input.completion,
				status: input.res.statusCode,
				stage: input.state.stage,
				failureReason: input.state.failureReason,
				redirect,
				outcome,
				durationMs: deps.now().getTime() - input.state.startedAtMs,
			});
		} catch {
			return;
		}
	};

	const start = (input: { route: GmailOAuthCorrelation["route"]; req: Request; res: Response }): void => {
		try {
			const state: GmailOAuthTraceState = {
				correlation: {
					route: input.route,
					traceId: randomUUID(),
					requestId: gatewayRequestIdOf(input.req),
					userId: input.req.userId,
				},
				startedAtMs: deps.now().getTime(),
				stage: "received",
				failureReason: undefined,
				completed: false,
			};
			traces.set(input.req, state);
			deps.record({
				...state.correlation,
				event: "gmail.oauth.request.received",
				level: "INFO",
				method: input.req.method,
				hxRequest: input.req.get("HX-Request") === "true",
			});
			input.res.once("finish", () => complete({ state, res: input.res, completion: "finished" }));
			input.res.once("close", () => complete({ state, res: input.res, completion: "aborted" }));
		} catch {
			return;
		}
	};

	const mark = (req: Request, stage: GmailOAuthStage): void => {
		const state = traces.get(req);
		if (state !== undefined) state.stage = stage;
	};

	return {
		begin: (route) => (req, res, next) => {
			start({ route, req, res });
			next();
		},
		guard: ({ stage, handler }) => (req, res, next) => {
			mark(req, stage);
			return handler(req, res, next);
		},
		enter: mark,
		fail: (req, reason) => {
			const state = traces.get(req);
			if (state !== undefined) state.failureReason = reason;
		},
		record: (req, fields) => {
			const state = traces.get(req);
			if (state !== undefined) deps.record({ ...state.correlation, ...fields });
		},
	};
}
