import type { AuthenticatedUserId } from "@packages/domain/user";
import { type EffectiveAccess, type GetEffectiveAccess, hasPaidFeatures } from "@packages/subscription-access";

/**
 * Whether the MCP surface is open to an authenticated caller.
 *
 * The decision is not re-derived here — it reuses `getEffectiveAccess` (the same
 * resolver the web banner reads).
 *
 * Nothing is ever attached to a *successful* result. The ChatGPT app developer
 * guidelines forbid promoting an upgrade from a tool response, and the Anthropic
 * directory requires token frugality; the only entitlement text either permits
 * is an explanation on the call the entitlement actually blocked.
 */

export type ToolAccess =
	| { readonly state: "ok"; readonly dailyLimited: boolean; readonly paidFeatures: boolean }
	| { readonly state: "unverified" };

export const UNVERIFIED_ACCESS = {
	state: "unverified",
} as const satisfies ToolAccess;

export type RefusalPhrases = {
	readonly subject: string;
};

export const SAVE_TOOL_PHRASES = {
	subject: "This link",
} as const satisfies RefusalPhrases;

export const CREATE_HIGHLIGHT_PHRASES = {
	subject: "This highlight",
} as const satisfies RefusalPhrases;

export type PaidFeatureRefusals = {
	readonly paidOnly: string;
	readonly checkFailed: string;
};

export const RELATED_ARTICLES_REFUSALS = {
	paidOnly: "Related articles are only on Readplace's paid plans, and this account is on the free plan. Upgrading to a paid plan in Readplace turns them on.",
	checkFailed: "Related articles weren't loaded because the subscription check didn't go through. Try again in a moment.",
} as const satisfies PaidFeatureRefusals;

export function toolRefusalMessage(params: { phrases: RefusalPhrases }): string {
	return `${params.phrases.subject} wasn't saved because the subscription check didn't go through. Try again in a moment.`;
}

export function initResolveToolAccess(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	isDailyLimited: (access: EffectiveAccess) => boolean;
}): (userId: AuthenticatedUserId) => Promise<ToolAccess> {
	return async (userId) => {
		const access = await deps.getEffectiveAccess(userId);
		return { state: "ok", dailyLimited: deps.isDailyLimited(access), paidFeatures: hasPaidFeatures(access) };
	};
}
