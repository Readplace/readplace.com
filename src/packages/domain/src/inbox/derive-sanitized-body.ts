import type { ParsedEmailInlineImage } from "./parse-email";
import { sanitizeEmailHtml } from "./sanitize-email-html";

/**
 * Turn a parsed newsletter's HTML + rehosted images into the safe HTML the View
 * tab renders and the link extractor reads. Each `cid:` inline image (already
 * resolved to an `email://cid/<id>` URL by the preparser) is inlined as a `data:`
 * URI carrying its bytes. `rehostedRemoteImages` maps an original remote
 * `<img>` src to the CDN copy the receive path downloaded at ingest; the
 * allowlist sanitizer keeps both kinds and strips every other remote image so
 * tracking beacons can't fire.
 *
 * The receive path is the ONLY caller that passes a populated
 * `rehostedRemoteImages`; link extraction passes `{}` on purpose — it reads
 * only `<a href>`s, and CDN image URLs in its derived body would surface as
 * phantom article links (and re-download every image on every run).
 *
 * Returns `""` when sanitizing leaves nothing renderable (a body composed
 * entirely of stripped tags); callers treat empty as "no body".
 */
export function deriveSanitizedBody(input: {
	html: string;
	inlineImages: ParsedEmailInlineImage[];
	rehostedRemoteImages: Record<string, string>;
}): string {
	// No key collisions: remote keys are `http(s)://`, cid keys are `email://cid/`.
	const rehostedImages: Record<string, string> = { ...input.rehostedRemoteImages };
	for (const image of input.inlineImages) {
		rehostedImages[`email://cid/${image.cid}`] =
			`data:${image.contentType};base64,${image.body.toString("base64")}`;
	}
	return sanitizeEmailHtml({ html: input.html, rehostedImages });
}
