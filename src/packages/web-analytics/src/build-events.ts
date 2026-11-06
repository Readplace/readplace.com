import assert from "node:assert";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { z } from "zod";
import type { UserId } from "@packages/domain/user";
import { type ViewerIp, viewerOf } from "@packages/viewer-identity";
import {
	ANALYTICS_EVENTS,
	type KeepOfferSurface,
	MALFORMED_PROTOCOL_VERSION,
	type McpRequestRefusalReason,
	type McpToolOutcome,
	type McpUaClient,
	type OAuthTokenKind,
	type OAuthTokenRevocationOutcome,
	SAVE_CLIENTS,
	SAVE_LINK_SURFACES,
	SAVE_SURFACE_QUERY,
	SAVE_SURFACES,
	OAUTH_TOKEN_REFUSAL_REASONS,
	type OAuthTokenGrantType,
	type PageExitKind,
	type SaveRefusalCode,
	type SaveClient,
	type SaveOutcome,
	type SaveSurface,
	type SignupOutcome,
	STREAMS,
} from "./events";
import {
	articleHostFromSubmitted,
	classifyContentSource,
} from "./content-source";
import { gatewayRequestIdOf } from "./gateway-request-id";
import type {
	KeepOfferClickedEvent,
	KeepOfferEventFields,
	KeepOfferShownEvent,
	McpRequestRefusedEvent,
	McpSaveIntentEvent,
	McpSessionInitializedEvent,
	McpToolCalledEvent,
	McpToolsListedEvent,
	OAuthTokenIssuedEvent,
	OAuthTokenRefusedEvent,
	OAuthTokenRevokedEvent,
	PageDepthEvent,
	SaveRefusedEvent,
	SignupAttemptedEvent,
	ViewEndCtaShownEvent,
	ViewSaveIntentEvent,
} from "./analytics-event.types";
import { classifyBrowser, classifyDeviceClass, mcpUaClientOf } from "./user-agent";
import { extractReferrerHost } from "./countable-request";

const ProtocolVersionSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function protocolVersionFieldOf(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	const parsed = ProtocolVersionSchema.safeParse(value);
	return parsed.success ? parsed.data : MALFORMED_PROTOCOL_VERSION;
}

const MCP_CLIENT_NAME_FIELD_LIMIT = 64;
const MCP_CLIENT_VERSION_FIELD_LIMIT = 32;

function clipped(value: string | undefined, limit: number): string | undefined {
	if (value === undefined) return undefined;
	return value.slice(0, limit);
}

export function buildSaveRefusedEvent(
	deps: { now: () => Date; salt: string },
	params: {
		req: Request;
		path: string;
		status: number;
		code: SaveRefusalCode;
		client: SaveClient;
	},
): SaveRefusedEvent {
	const gatewayRequestId = gatewayRequestIdOf(params.req);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.saveRefused,
		timestamp: deps.now().toISOString(),
		path: params.path,
		code: params.code,
		status: params.status,
		client: params.client,
		is_authenticated: params.req.userId ? 1 : 0,
		...(params.req.userId ? { user_id: params.req.userId } : {}),
		...(gatewayRequestId === undefined ? {} : { request_id: gatewayRequestId }),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
	};
}

type KeepOfferEventDeps = { now: () => Date; salt: string };

type KeepOfferEventParams = {
	req: Request;
	userId: UserId;
	surface: KeepOfferSurface;
	trialDay: number;
};

function keepOfferEventFields(
	deps: KeepOfferEventDeps,
	params: KeepOfferEventParams,
): KeepOfferEventFields {
	const gatewayRequestId = gatewayRequestIdOf(params.req);
	return {
		stream: STREAMS.analytics,
		timestamp: deps.now().toISOString(),
		user_id: params.userId,
		surface: params.surface,
		trial_day: params.trialDay,
		...(gatewayRequestId === undefined ? {} : { request_id: gatewayRequestId }),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
	};
}

export function buildKeepOfferShownEvent(
	deps: KeepOfferEventDeps,
	params: KeepOfferEventParams,
): KeepOfferShownEvent {
	return { ...keepOfferEventFields(deps, params), event: ANALYTICS_EVENTS.keepOfferShown };
}

export function buildKeepOfferClickedEvent(
	deps: KeepOfferEventDeps,
	params: KeepOfferEventParams,
): KeepOfferClickedEvent {
	return { ...keepOfferEventFields(deps, params), event: ANALYTICS_EVENTS.keepOfferClicked };
}

/**
 * Clamps the browser's numbers before they become a metric: a reader who
 * over-scrolls past the end (rubber-banding on iOS) must not read as having
 * seen more than the page holds, and a page shorter than the viewport is fully
 * seen rather than more-than-fully seen.
 */
export function buildPageDepthEvent(
	deps: { now: () => Date; salt: string },
	params: {
		req: Request;
		path: string;
		deepestPx: number;
		pageHeightPx: number;
		viewportHeightPx: number;
		exitKind: PageExitKind;
	},
): PageDepthEvent {
	const pageHeight = Math.max(params.pageHeightPx, 1);
	const deepest = Math.min(Math.max(params.deepestPx, 0), pageHeight);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.pageDepth,
		timestamp: deps.now().toISOString(),
		path: params.path,
		deepest_px: deepest,
		page_height_px: pageHeight,
		viewport_height_px: Math.max(params.viewportHeightPx, 0),
		unseen_px: pageHeight - deepest,
		seen_percent: Math.round((deepest / pageHeight) * 100),
		exit_kind: params.exitKind,
		device_class: classifyDeviceClass(params.req.get("user-agent")),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
		visitor_id: params.req.visitorId ?? null,
		is_authenticated: params.req.userId ? 1 : 0,
	};
}

export function buildOAuthTokenIssuedEvent(
	deps: { now: () => Date; salt: string },
	params: { req: Request; grantType: OAuthTokenGrantType; clientId: string },
): OAuthTokenIssuedEvent {
	const gatewayRequestId = gatewayRequestIdOf(params.req);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.oauthTokenIssued,
		timestamp: deps.now().toISOString(),
		grant_type: params.grantType,
		client_id: params.clientId,
		...(gatewayRequestId === undefined ? {} : { request_id: gatewayRequestId }),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
	};
}

export function buildOAuthTokenRefusedEvent(
	deps: { now: () => Date; salt: string },
	params: { req: Request; grantType: OAuthTokenGrantType; clientId: string; status: number },
): OAuthTokenRefusedEvent {
	const gatewayRequestId = gatewayRequestIdOf(params.req);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.oauthTokenRefused,
		timestamp: deps.now().toISOString(),
		grant_type: params.grantType,
		client_id: params.clientId,
		status: params.status,
		reason:
			params.status === 429
				? OAUTH_TOKEN_REFUSAL_REASONS.rateLimited
				: OAUTH_TOKEN_REFUSAL_REASONS.rejected,
		...(gatewayRequestId === undefined ? {} : { request_id: gatewayRequestId }),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
	};
}

export function buildOAuthTokenRevokedEvent(
	deps: { now: () => Date; salt: string },
	params: {
		req: Request;
		clientId: string;
		grantId: string | undefined;
		outcome: OAuthTokenRevocationOutcome;
		tokenKind: OAuthTokenKind;
	},
): OAuthTokenRevokedEvent {
	const gatewayRequestId = gatewayRequestIdOf(params.req);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.oauthTokenRevoked,
		timestamp: deps.now().toISOString(),
		client_id: params.clientId,
		grant_id: params.grantId,
		outcome: params.outcome,
		token_kind: params.tokenKind,
		...(gatewayRequestId === undefined ? {} : { request_id: gatewayRequestId }),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
	};
}

export function buildMcpRequestRefusedEvent(
	deps: { now: () => Date; salt: string },
	params: {
		req: Request;
		status: number;
		reason: McpRequestRefusalReason;
		offeredProtocolVersion: unknown;
		oauthClientId: string | undefined;
		userId: UserId | undefined;
	},
): McpRequestRefusedEvent {
	const gatewayRequestId = gatewayRequestIdOf(params.req);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.mcpRequestRefused,
		timestamp: deps.now().toISOString(),
		status: params.status,
		reason: params.reason,
		ua_client: mcpUaClientOf(params.req.get("user-agent")),
		offered_protocol_version: protocolVersionFieldOf(params.offeredProtocolVersion),
		oauth_client_id: params.oauthClientId,
		user_id: params.userId,
		...(gatewayRequestId === undefined ? {} : { request_id: gatewayRequestId }),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
	};
}

export function buildMcpSessionInitializedEvent(
	deps: { now: () => Date },
	params: {
		oauthClientId: string;
		userId: UserId;
		clientProtocolVersion: unknown;
		clientName: string | undefined;
		clientVersion: string | undefined;
	},
): McpSessionInitializedEvent {
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.mcpSessionInitialized,
		timestamp: deps.now().toISOString(),
		oauth_client_id: params.oauthClientId,
		user_id: params.userId,
		client_protocol_version: protocolVersionFieldOf(params.clientProtocolVersion),
		client_name: clipped(params.clientName, MCP_CLIENT_NAME_FIELD_LIMIT),
		client_version: clipped(params.clientVersion, MCP_CLIENT_VERSION_FIELD_LIMIT),
	};
}

export function buildMcpToolsListedEvent(
	deps: { now: () => Date },
	params: { oauthClientId: string; userId: UserId; toolCount: number; uaClient: McpUaClient },
): McpToolsListedEvent {
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.mcpToolsListed,
		timestamp: deps.now().toISOString(),
		oauth_client_id: params.oauthClientId,
		user_id: params.userId,
		tool_count: params.toolCount,
		ua_client: params.uaClient,
	};
}

export function hashIp(deps: { ip: ViewerIp | undefined; salt: string }): string | null {
	if (!deps.ip) return null;
	return createHash("sha256")
		.update(deps.ip + deps.salt)
		.digest("hex")
		.slice(0, 16);
}

const SaveLinkSurfaceSchema = z.enum(SAVE_LINK_SURFACES);

export function deriveSaveSurface(req: Request): SaveSurface {
	const parsed = SaveLinkSurfaceSchema.safeParse(req.query[SAVE_SURFACE_QUERY]);
	return parsed.success ? parsed.data : SAVE_SURFACES.unknown;
}

/**
 * Builds a `view_save_intent` event for any save surface. Centralizing the
 * derivation keeps `article_host` (and therefore `content_class`) normalized
 * identically across surfaces and joinable with `view_opened`, and keeps the
 * dedup/exclusion identifier (`visitor_id`) consistent so the same dashboard
 * exclusions apply to every emission. `referrer_host` is the traffic source,
 * captured separately from `article_host` and never used for `content_class`.
 */
export function buildSaveIntentEvent(
	deps: { now: () => Date; salt: string },
	params: {
		req: Request;
		url: string;
		path: string;
		surface: SaveSurface;
		outcome: SaveOutcome;
		client: SaveClient;
		pendingSaveId?: string;
	},
): ViewSaveIntentEvent {
	assert(params.req.visitorId, "visitor-id middleware must run before a save surface emits view_save_intent");
	const articleHost = articleHostFromSubmitted(params.url);
	const referrerHost = extractReferrerHost(params.req);
	const userAgent = params.req.get("user-agent");
	const gatewayRequestId = gatewayRequestIdOf(params.req);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.viewSaveIntent,
		timestamp: deps.now().toISOString(),
		path: params.path,
		article_host: articleHost,
		content_class: articleHost === null ? null : classifyContentSource(articleHost),
		surface: params.surface,
		outcome: params.outcome,
		client: params.client,
		device_class: classifyDeviceClass(userAgent),
		browser: classifyBrowser(userAgent),
		...(referrerHost ? { referrer_host: referrerHost } : {}),
		...(params.pendingSaveId ? { pending_save_id: params.pendingSaveId } : {}),
		...(gatewayRequestId === undefined ? {} : { request_id: gatewayRequestId }),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
		visitor_id: params.req.visitorId,
		is_authenticated: params.req.userId ? 1 : 0,
	};
}

export function buildViewEndCtaShownEvent(
	deps: { now: () => Date; salt: string },
	params: { req: Request; path: string; articleHost: string },
): ViewEndCtaShownEvent {
	assert(params.req.visitorId, "visitor-id middleware must run before the reader emits view_end_cta_shown");
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.viewEndCtaShown,
		timestamp: deps.now().toISOString(),
		path: params.path,
		article_host: params.articleHost,
		device_class: classifyDeviceClass(params.req.get("user-agent")),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
		visitor_id: params.req.visitorId,
		is_authenticated: 0,
	};
}

export function buildMcpToolCalledEvent(
	deps: { now: () => Date },
	params: {
		tool: string;
		outcome: McpToolOutcome;
		oauthClientId: string;
		userId: UserId;
		submittedUrl?: string;
		sortOrder?: "asc" | "desc";
	},
): McpToolCalledEvent {
	const articleHost =
		params.submittedUrl === undefined
			? null
			: articleHostFromSubmitted(params.submittedUrl);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.mcpToolCalled,
		timestamp: deps.now().toISOString(),
		tool: params.tool,
		outcome: params.outcome,
		oauth_client_id: params.oauthClientId,
		user_id: params.userId,
		sort_order: params.sortOrder,
		...(articleHost === null
			? {}
			: {
					article_host: articleHost,
					content_class: classifyContentSource(articleHost),
				}),
	};
}

export function buildMcpSaveIntentEvent(
	deps: { now: () => Date },
	params: { url: string; path: string; outcome: SaveOutcome; userId: UserId },
): McpSaveIntentEvent {
	const articleHost = articleHostFromSubmitted(params.url);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.viewSaveIntent,
		timestamp: deps.now().toISOString(),
		path: params.path,
		article_host: articleHost,
		content_class: articleHost === null ? null : classifyContentSource(articleHost),
		surface: SAVE_SURFACES.mcp,
		outcome: params.outcome,
		client: SAVE_CLIENTS.mcp,
		device_class: classifyDeviceClass(undefined),
		browser: classifyBrowser(undefined),
		visitor_hash: null,
		visitor_id: null,
		is_authenticated: 1,
		user_id: params.userId,
	};
}

export function buildSignupAttemptedEvent(
	deps: { now: () => Date; salt: string },
	params: { req: Request; outcome: SignupOutcome },
): SignupAttemptedEvent {
	assert(params.req.visitorId, "visitor-id middleware must run before POST /signup emits signup_attempted");
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.signupAttempted,
		timestamp: deps.now().toISOString(),
		method: "email",
		outcome: params.outcome,
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
		visitor_id: params.req.visitorId,
		is_authenticated: 0,
	};
}
