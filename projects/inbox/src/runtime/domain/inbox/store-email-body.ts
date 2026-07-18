import {
	deriveSanitizedBody,
	emailImageCdnUrl,
	emailImageS3KeyPrefix,
} from "@packages/domain/inbox";
import type { ParsedEmailInlineImage } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { PutImageObject } from "@packages/finalize-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { DownloadedEmailImage } from "./download-email-images";
import { emailContentResourceId } from "./email-content-id";

export type StoreEmailBody = (input: {
	userId: UserId;
	receivedAtMessageId: string;
	html: string;
	inlineImages: ParsedEmailInlineImage[];
	downloadedImages: DownloadedEmailImage[];
}) => Promise<string | undefined>;

/**
 * Turn a parsed newsletter into the safe HTML the View tab renders, and write it
 * to the content bucket. Each `cid:` inline image (already resolved to an
 * `email://cid/<id>` URL by the preparser) is inlined as a `data:` URI carrying
 * its bytes; each remote image the receive path downloaded (once per message) is
 * uploaded under this recipient's opaque image prefix and its src rewritten to
 * our CDN, so the sender saw a single AWS-origin fetch instead of the reader's
 * browser. The allowlist sanitizer keeps both kinds and strips every other
 * remote src, so tracking beacons can't fire from the View tab. An image whose
 * upload fails is skipped (its src is stripped — the pre-rehost look) rather
 * than costing the whole body.
 *
 * Returns the S3 key the body was written to, or `undefined` when sanitizing
 * leaves nothing renderable — a body composed entirely of tags the sanitizer
 * strips wholesale (`<style>`/`<script>` and friends). Writing that empty result
 * would store a zero-byte object that reads back as `""` (present, not absent),
 * rendering a blank iframe; returning `undefined` (and writing nothing) lets the
 * caller persist the row as `unparsed` so the detail page shows its graceful
 * unavailable panel instead.
 */
export function initStoreEmailBody(deps: {
	putContent: (input: { key: string; html: string }) => Promise<void>;
	putImageObject: PutImageObject;
	imagesCdnBaseUrl: string;
	logger: HutchLogger;
}): StoreEmailBody {
	return async ({ userId, receivedAtMessageId, html, inlineImages, downloadedImages }) => {
		const rehostedRemoteImages: Record<string, string> = {};
		for (const image of downloadedImages) {
			const prefix = emailImageS3KeyPrefix({ userId, receivedAtMessageId });
			try {
				await deps.putImageObject({
					key: `${prefix}/${image.filename}`,
					body: image.body,
					contentType: image.contentType,
				});
				rehostedRemoteImages[image.originalUrl] = emailImageCdnUrl({
					baseUrl: deps.imagesCdnBaseUrl,
					userId,
					receivedAtMessageId,
					filename: image.filename,
				});
			} catch (error) {
				deps.logger.error("[store-email-body] failed to upload rehosted image", {
					url: image.originalUrl,
					error,
				});
			}
		}
		const safeHtml = deriveSanitizedBody({ html, inlineImages, rehostedRemoteImages });
		if (safeHtml.trim() === "") return undefined;
		const key = emailContentResourceId({ userId, receivedAtMessageId }).toS3ContentKey();
		await deps.putContent({ key, html: safeHtml });
		return key;
	};
}
