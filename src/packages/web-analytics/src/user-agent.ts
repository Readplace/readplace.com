import type { Request } from "express";
import { isbot } from "isbot";
import { MCP_UA_CLIENTS, type McpUaClient } from "./events";

/**
 * Coarse device buckets for slicing authenticated reads by cohort. `other`
 * covers an absent User-Agent (no signal); `desktop` is the fallback for a
 * present UA that matches none of the mobile/tablet/bot fingerprints.
 */
export type DeviceClass =
	| "desktop"
	| "mobile_ios"
	| "mobile_android"
	| "tablet"
	| "bot"
	| "other";

/**
 * One anchored arm per shipped native app, so a bot UA that merely mentions our
 * app never matches. iOS sends the stock URLSession UA (two binaries — the app
 * and its share extension); Android replaces OkHttp's default with a UA of the
 * same `Product/version` shape, since `okhttp/x` identifies nothing.
 */
const NATIVE_CLIENT_USER_AGENTS = {
	ios: /^(?:Readplace|ShareExtension)\/(?:\d+ CFNetwork\/[\d.]+ Darwin\/[\d.]+|build-\d+ iOS\/[\w.]+)$/,
	android: /^Readplace\/\d+ Android\/[\w.]+$/,
} as const;

/** Which native app sent this User-Agent, or undefined for anything else. */
export function readplaceNativeClientOf(userAgent: string | undefined): "ios" | "android" | undefined {
	if (userAgent === undefined) return undefined;
	if (NATIVE_CLIENT_USER_AGENTS.ios.test(userAgent)) return "ios";
	if (NATIVE_CLIENT_USER_AGENTS.android.test(userAgent)) return "android";
	return undefined;
}

const MCP_UA_CLIENT_USER_AGENTS = {
	codex: /^openai-mcp\/[\d.]+ \(Codex\)$/,
	openai: /^openai-(?:mcp|connectors-oauth)\/[\d.]+$/,
	claude: /^Claude-User(?:[/ ;]|$)/,
} satisfies Record<Exclude<McpUaClient, "other">, RegExp>;

export function mcpUaClientOf(userAgent: string | undefined): McpUaClient {
	if (userAgent === undefined) return MCP_UA_CLIENTS.other;
	if (MCP_UA_CLIENT_USER_AGENTS.codex.test(userAgent)) return MCP_UA_CLIENTS.codex;
	if (MCP_UA_CLIENT_USER_AGENTS.openai.test(userAgent)) return MCP_UA_CLIENTS.openai;
	if (MCP_UA_CLIENT_USER_AGENTS.claude.test(userAgent)) return MCP_UA_CLIENTS.claude;
	return MCP_UA_CLIENTS.other;
}

export function isReadplaceNativeClient(userAgent: string | undefined): boolean {
	return readplaceNativeClientOf(userAgent) !== undefined;
}

export function isBotUserAgent(userAgent: string | undefined): boolean {
	if (isReadplaceNativeClient(userAgent)) return false;
	return isbot(userAgent);
}

export function isBotRequest(req: Request): boolean {
	if (req.userId) return false;
	const userAgent = req.get("user-agent");
	if (!userAgent) return true;
	return isBotUserAgent(userAgent);
}

/**
 * Derives a `DeviceClass` from the request User-Agent. Only the class is ever
 * returned or logged — the raw UA is discarded here, preserving the no-raw-UA /
 * hashed-IP posture the rest of the analytics layer keeps. Android tablets omit
 * `Mobile` from the UA token, which separates them from Android phones.
 */
export function classifyDeviceClass(userAgent: string | undefined): DeviceClass {
	if (!userAgent) return "other";
	const nativeClient = readplaceNativeClientOf(userAgent);
	if (nativeClient === "ios") return "mobile_ios";
	if (nativeClient === "android") return "mobile_android";
	if (isbot(userAgent)) return "bot";
	const isAndroid = userAgent.includes("Android");
	if (userAgent.includes("iPad") || (isAndroid && !userAgent.includes("Mobile"))) return "tablet";
	if (userAgent.includes("iPhone") || userAgent.includes("iPod")) return "mobile_ios";
	if (isAndroid) return "mobile_android";
	return "desktop";
}

/**
 * Browser families for the audience device-mix pie. `other` folds an absent UA,
 * a bot UA, and any browser outside this set into one low-cardinality slice, and
 * preserves the no-raw-UA posture — only the family is logged, never the version
 * or the raw UA.
 */
export type BrowserFamily =
	| "chrome"
	| "safari"
	| "firefox"
	| "edge"
	| "samsung_internet"
	| "opera"
	| "other";

/**
 * Derives a `BrowserFamily` from the User-Agent. Order is the correctness crux:
 * every Chromium UA carries a `Safari/` token and every Chromium *derivative*
 * (Edge, Opera, Samsung) also carries `Chrome/`, so the derivatives match first,
 * then Chrome, then Safari last — otherwise Edge/Opera/Samsung would read as
 * Chrome and every Chromium browser as Safari. iOS wrappers (CriOS/FxiOS/EdgiOS/
 * OPiOS) map to their family, not Safari. The `isbot` guard mirrors
 * classifyDeviceClass: Googlebot's smartphone UA embeds a real `Chrome/` token,
 * so the guard stops any future caller from miscounting it.
 */
export function classifyBrowser(userAgent: string | undefined): BrowserFamily {
	if (!userAgent) return "other";
	if (isbot(userAgent)) return "other";
	if (userAgent.includes("Edg/") || userAgent.includes("EdgA/") || userAgent.includes("EdgiOS/")) return "edge";
	if (userAgent.includes("OPR/") || userAgent.includes("OPiOS/")) return "opera";
	if (userAgent.includes("SamsungBrowser/")) return "samsung_internet";
	if (userAgent.includes("FxiOS/") || userAgent.includes("Firefox/")) return "firefox";
	if (userAgent.includes("CriOS/") || userAgent.includes("Chrome/")) return "chrome";
	if (userAgent.includes("Safari/")) return "safari";
	return "other";
}

export type OsFamily = "windows" | "macos" | "linux" | "chromeos" | "ios" | "android" | "ereader" | "other";

export function classifyOsFamily(userAgent: string | undefined): OsFamily {
	if (!userAgent) return "other";
	const nativeClient = readplaceNativeClientOf(userAgent);
	if (nativeClient !== undefined) return nativeClient;
	if (/Kobo|Kindle\/|PocketBook\//.test(userAgent)) return "ereader";
	if (isbot(userAgent)) return "other";
	if (userAgent.includes("CrOS")) return "chromeos";
	if (userAgent.includes("Android")) return "android";
	if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
	if (userAgent.includes("Windows NT")) return "windows";
	if (userAgent.includes("Macintosh")) return "macos";
	if (userAgent.includes("Linux") || userAgent.includes("X11")) return "linux";
	return "other";
}
