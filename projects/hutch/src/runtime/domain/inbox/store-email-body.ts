import { sanitizeEmailHtml } from "@packages/domain/inbox";
import type { ParsedEmailInlineImage } from "@packages/domain/inbox";
import { emailContentResourceId } from "./email-content-id";

export type StoreEmailBody = (input: {
	receivedAtMessageId: string;
	html: string;
	inlineImages: ParsedEmailInlineImage[];
}) => Promise<string>;

/**
 * Turn a parsed newsletter into the safe HTML the View tab renders, and write it
 * to the content bucket. Each `cid:` inline image (already resolved to an
 * `email://cid/<id>` URL by the preparser) is inlined as a `data:` URI carrying
 * its bytes, then the allowlist sanitizer keeps those — and strips every remote
 * image so tracking beacons can't fire. Inlining (rather than rehosting to a
 * cross-origin CDN) is what lets the images render inside the View tab's
 * sandboxed, opaque-origin iframe. Returns the S3 key the body was written to.
 */
export function initStoreEmailBody(deps: {
	putContent: (input: { key: string; html: string }) => Promise<void>;
}): StoreEmailBody {
	return async ({ receivedAtMessageId, html, inlineImages }) => {
		const rehostedImages: Record<string, string> = {};
		for (const image of inlineImages) {
			rehostedImages[`email://cid/${image.cid}`] =
				`data:${image.contentType};base64,${image.body.toString("base64")}`;
		}
		const safeHtml = sanitizeEmailHtml({ html, rehostedImages });
		const key = emailContentResourceId(receivedAtMessageId).toS3ContentKey();
		await deps.putContent({ key, html: safeHtml });
		return key;
	};
}
