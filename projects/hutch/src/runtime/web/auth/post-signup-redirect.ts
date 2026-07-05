import { validateSaveableUrl } from "@packages/domain/article";
import { parseReturnUrl } from "./parse-return-url";

const AUTOSAVE_MARKER: [string, string] = ["utm_source", "signup-autosave"];

/** Where a fresh signup lands. An explicit `?return=` always wins (the /save
 * round-trip already carries and saves the held article in that case, so
 * auto-saving too would double-save). Otherwise, when the anonymous visitor was
 * reading an article just before signing up, redirect through /queue?url=… so
 * the auto-submit save form drops that first article into the new empty queue.
 * The URL is re-validated with the same validator used everywhere else so a
 * tampered cookie can never reach the save. */
export function resolvePostSignupRedirect(params: {
	returnUrl: string | undefined;
	lastViewUrl: string | undefined;
}): string {
	const fallback = parseReturnUrl({ return: params.returnUrl });
	if (params.returnUrl !== undefined) return fallback;
	if (params.lastViewUrl === undefined) return fallback;
	const validation = validateSaveableUrl(params.lastViewUrl);
	if (validation.status === "ERROR") return fallback;
	const qs = new URLSearchParams([["url", validation.url], AUTOSAVE_MARKER]);
	return `/queue?${qs.toString()}`;
}
