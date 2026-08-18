import type { AuthenticatedUserId } from "@packages/domain/user";
import type { GetEffectiveAccess } from "@packages/subscription-access";

/**
 * Whether the MCP surface is open to an authenticated caller.
 *
 * The decision is not re-derived here — it reuses `getEffectiveAccess` (the same
 * resolver the web banner reads), so "lapsed" means exactly what it means on the
 * web. The caller (`mcp-server`) owns the envelope: it returns `message` as a
 * tool error when an inactive caller tries to save, and every other tool stays
 * open.
 *
 * Nothing is ever attached to a *successful* result. The ChatGPT app developer
 * guidelines forbid promoting an upgrade from a tool response, and the Anthropic
 * directory requires token frugality; the only entitlement text either permits
 * is an explanation on the call the entitlement actually blocked, which is what
 * `message` is.
 */

/** Hard-coded production URL for the account page where a renewal is completed. */
const APP_ACCOUNT_URL = "https://readplace.com/account";

const INACTIVE_MESSAGE =
	"Saving new links is paused because this Readplace subscription isn't active. " +
	`Everything already saved stays readable and exportable, and the subscription can be reactivated at ${APP_ACCOUNT_URL}.`;

export type ToolAccess =
	| { readonly state: "ok" }
	| { readonly state: "inactive"; readonly message: string };

export function initResolveToolAccess(deps: {
	getEffectiveAccess: GetEffectiveAccess;
}): (userId: AuthenticatedUserId) => Promise<ToolAccess> {
	return async (userId) => {
		const access = await deps.getEffectiveAccess(userId);
		if (access.access === "read-only") {
			return { state: "inactive", message: INACTIVE_MESSAGE };
		}
		return { state: "ok" };
	};
}
