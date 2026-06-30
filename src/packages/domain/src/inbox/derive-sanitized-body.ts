import type { ParsedEmailInlineImage } from "./parse-email";
import { sanitizeEmailHtml } from "./sanitize-email-html";

/**
 * Turn a parsed newsletter's HTML + inline images into the safe HTML the View
 * tab renders and the link extractor reads. Each `cid:` inline image (already
 * resolved to an `email://cid/<id>` URL by the preparser) is inlined as a `data:`
 * URI carrying its bytes; the allowlist sanitizer keeps those and strips every
 * remote image so tracking beacons can't fire.
 *
 * Returns `""` when sanitizing leaves nothing renderable (a body composed
 * entirely of stripped tags); callers treat empty as "no body".
 *
 * Shared by the receive path (View-tab body cache) and the link-extraction
 * consumer so both derive the body through the SAME parse/sanitize logic — a
 * future sanitizer change applies to extraction too, with no stale snapshot.
 */
export function deriveSanitizedBody(input: {
	html: string;
	inlineImages: ParsedEmailInlineImage[];
}): string {
	const rehostedImages: Record<string, string> = {};
	for (const image of input.inlineImages) {
		rehostedImages[`email://cid/${image.cid}`] =
			`data:${image.contentType};base64,${image.body.toString("base64")}`;
	}
	return sanitizeEmailHtml({ html: input.html, rehostedImages });
}
