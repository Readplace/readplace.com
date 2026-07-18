import { validateSaveableUrl } from "@packages/domain/article";
import { parseReturnUrl } from "./parse-return-url";

const AUTOSAVE_MARKER: [string, string] = ["utm_source", "signup-autosave"];

export interface PostSignupRedirect {
	/** The 303 target. Always internal — either the parsed `?return=` path or the
	 * `/queue?url=…` autosave URL. */
	location: string;
	/** The validated article URL being auto-saved, present only when this signup
	 * triggers a first-article autosave. Lets the caller emit the discrete
	 * `first_article_autosaved` event 1:1 with the trigger without re-deriving the
	 * decision. `undefined` for every non-autosave landing. */
	autosavedUrl?: string;
}

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
}): PostSignupRedirect {
	const fallback = parseReturnUrl({ return: params.returnUrl });
	if (params.returnUrl !== undefined) return { location: fallback };
	if (params.lastViewUrl === undefined) return { location: fallback };
	const validation = validateSaveableUrl(params.lastViewUrl);
	if (validation.status === "ERROR") return { location: fallback };
	const qs = new URLSearchParams([["url", validation.url], AUTOSAVE_MARKER]);
	return { location: `/queue?${qs.toString()}`, autosavedUrl: validation.url };
}
