import type { Request } from "express";

/** The reader-ready email links to the owner's private reader. The marker
 * distinguishes that email click from a copied/shared permalink: only the
 * email link sends a logged-out owner to login (they already saved the
 * article), while a bare permalink keeps redirecting strangers to the
 * public /view share page. Producer and consumer share this one constant
 * so they can't drift — an internal, same-deploy contract. */
const MARKER_KEY = "from";
const MARKER_VALUE = "reader-ready-email";

export function buildOwnerReaderPath(articleId: { value: string }): string {
	return `/queue/${articleId.value}/view?${MARKER_KEY}=${MARKER_VALUE}`;
}

export function wantsOwnerLogin(query: Request["query"]): boolean {
	return query[MARKER_KEY] === MARKER_VALUE;
}
