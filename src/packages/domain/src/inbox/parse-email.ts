import assert from "node:assert";
import { createHash } from "node:crypto";
import PostalMime, { type Email } from "postal-mime";
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
	/** Full newsletter HTML with every `cid:` reference rewritten to a
	 * parser-local `email://cid/<id>` URL the media-rehost step recognises. */
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

/**
 * Parse a raw RFC-822 `.eml` into the fields the inbox needs, acting as the
 * email preparser: it resolves `cid:` inline-image references to parser-local
 * URLs and returns the matching part bytes so the receive path can rehost them.
 *
 * Never throws: any failure — a structural limit postal-mime rejects, or a
 * message with no renderable body (an undecodable winmail.dat/TNEF part, or
 * garbage) — returns `{ ok: false }` so the caller can degrade-with-alert while
 * keeping the immutable raw `.eml`.
 */
export async function parseEmail(input: {
	raw: Buffer;
	receivedAt: string;
}): Promise<ParseEmailResult> {
	let parsed: Email;
	try {
		parsed = await PostalMime.parse(input.raw, { attachmentEncoding: "arraybuffer" });
	} catch {
		return { ok: false, reason: "unparseable" };
	}

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
		html = html.replace(
			new RegExp(`cid:${escapeRegExp(cid)}(?=["'\\s>)\\]]|$)`, "g"),
			`email://cid/${cid}`,
		);
	}

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
}
