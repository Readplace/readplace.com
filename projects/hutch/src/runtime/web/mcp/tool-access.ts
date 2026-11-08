import type { AuthenticatedUserId } from "@packages/domain/user";
import type { GetEffectiveAccess } from "@packages/subscription-access";

/**
 * Whether the MCP surface is open to an authenticated caller.
 *
 * The decision is not re-derived here — it reuses `getEffectiveAccess` (the same
 * resolver the web banner reads), so "lapsed" means exactly what it means on the
 * web.
 *
 * Nothing is ever attached to a *successful* result. The ChatGPT app developer
 * guidelines forbid promoting an upgrade from a tool response, and the Anthropic
 * directory requires token frugality; the only entitlement text either permits
 * is an explanation on the call the entitlement actually blocked.
 */

export type ToolAccess =
	| { readonly state: "ok" }
	| { readonly state: "inactive" }
	| { readonly state: "unverified" };

export const UNVERIFIED_ACCESS = {
	state: "unverified",
} as const satisfies ToolAccess;

export type RefusalPhrases = {
	readonly action: string;
	readonly subject: string;
};

export const SAVE_TOOL_PHRASES = {
	action: "Saving new links",
	subject: "This link",
} as const satisfies RefusalPhrases;

export const CREATE_HIGHLIGHT_PHRASES = {
	action: "Creating highlights",
	subject: "This highlight",
} as const satisfies RefusalPhrases;

export function toolRefusalMessage(params: {
	state: Exclude<ToolAccess["state"], "ok">;
	phrases: RefusalPhrases;
	appOrigin: string;
}): string {
	if (params.state === "unverified") {
		return `${params.phrases.subject} wasn't saved because the subscription check didn't go through. Try again in a moment.`;
	}
	return (
		`${params.phrases.action} is paused because this Readplace subscription isn't active. ` +
		`Everything already saved stays readable and exportable, and the subscription can be reactivated at ${new URL("/account", params.appOrigin).toString()}.`
	);
}

export function initResolveToolAccess(deps: {
	getEffectiveAccess: GetEffectiveAccess;
}): (userId: AuthenticatedUserId) => Promise<ToolAccess> {
	return async (userId) => {
		const access = await deps.getEffectiveAccess(userId);
		if (access.access === "read-only") {
			return { state: "inactive" };
		}
		return { state: "ok" };
	};
}
