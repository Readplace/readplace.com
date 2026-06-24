import assert from "node:assert";
import { createHash } from "node:crypto";
import PostalMime from "postal-mime";
import { type MessageId, MessageIdSchema } from "./inbox-email.schema";

export interface ParsedEmailInlineImage {
	/** The bare Content-ID (no angle brackets), matching the `cid:` URI body. */
	cid: string;
	contentType: string;
	body: Buffer;
}

export interface ParsedEmail {
	/** Best-effort sender address for display; `""` when absent. */
	from: string;
	subject: string;
	text: string;
	/** The renderable body as HTML. For a normal message this is the `text/html`
	 * part with every `cid:` reference rewritten to a parser-local
	 * `email://cid/<id>` URL the receive path resolves to its inline image; for a
	 * `text/plain`-only message it is a `<pre>` wrapper around the HTML-escaped
	 * text. Never empty when the parse succeeds. */
	html: string;
	messageId: MessageId;
	/** Injected SES receipt time — never the (forgeable) `Date:` header. */
	receivedAt: string;
	inlineImages: ParsedEmailInlineImage[];
}

export type ParseEmailResult =
	| { ok: true; email: ParsedEmail }
	| { ok: false; reason: "unparseable" };

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Drop the angle brackets a MIME `Content-ID` header carries (`<logo@x>`) so it
 * matches the bare token an HTML `cid:` URI uses (`cid:logo@x`). */
function bareContentId(contentId: string): string {
	return contentId.replace(/^</, "").replace(/>$/, "");
}

/** Escape the HTML-significant characters so a `text/plain` body embeds as inert
 * element content — markup in the text renders literally instead of as nodes. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Parse a raw RFC-822 `.eml` into the fields the inbox needs, acting as the
 * email preparser: it resolves `cid:` inline-image references to parser-local
 * URLs and returns the matching part bytes so the receive path can inline them
 * as `data:` URIs.
 *
 * Never throws: any failure — a structural limit postal-mime rejects, a message
 * with no renderable body (an undecodable winmail.dat/TNEF part, or garbage), or
 * any other decode surprise — returns `{ ok: false }` so the caller can
 * degrade-with-alert while keeping the immutable raw `.eml`.
 */
export async function parseEmail(input: {
	raw: Buffer;
	receivedAt: string;
}): Promise<ParseEmailResult> {
	try {
		const parsed = await PostalMime.parse(input.raw, { attachmentEncoding: "arraybuffer" });

		const text = parsed.text ?? "";
		let html = parsed.html ?? "";
		if (html === "" && text === "") return { ok: false, reason: "unparseable" };

		const inlineImages: ParsedEmailInlineImage[] = [];
		for (const attachment of parsed.attachments) {
			if (attachment.contentId === undefined) continue;
			const cid = bareContentId(attachment.contentId);
			const content = attachment.content;
			assert(
				content instanceof ArrayBuffer,
				"arraybuffer attachment encoding must yield ArrayBuffer content",
			);
			inlineImages.push({ cid, contentType: attachment.mimeType, body: Buffer.from(content) });
			// A replacement function (not a string) so a `$&`/`` $` ``/`$'` sequence in
			// the Content-ID is taken literally instead of as a replacement pattern.
			html = html.replace(
				new RegExp(`cid:${escapeRegExp(cid)}(?=["'\\s>)\\]]|$)`, "g"),
				() => `email://cid/${cid}`,
			);
		}

		// A text/plain-only message has no HTML part. Wrap its HTML-escaped text in
		// <pre> so whitespace and line breaks survive, keeping every downstream stage
		// (sanitizer → S3 body → iframe) on the single `html` contract — a `received`
		// row therefore never stores an empty body that would render a blank View tab.
		if (html === "") html = `<pre>${escapeHtml(text)}</pre>`;

		const messageId = MessageIdSchema.parse(
			parsed.messageId ?? `sha256:${createHash("sha256").update(input.raw).digest("hex")}`,
		);

		return {
			ok: true,
			email: {
				from: parsed.from?.address ?? "",
				subject: parsed.subject ?? "",
				text,
				html,
				messageId,
				receivedAt: input.receivedAt,
				inlineImages,
			},
		};
	} catch {
		// Any decode failure — postal-mime rejecting the structure, or a postal-mime
		// contract surprise the assert above catches — degrades to a kept-raw audit.
		return { ok: false, reason: "unparseable" };
	}
}
