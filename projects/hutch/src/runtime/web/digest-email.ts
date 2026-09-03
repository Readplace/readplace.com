import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "./email-colors";
import { EMAIL_REPLY_INVITATION } from "./email-copy";
import { render } from "@packages/web-shell";

const DIGEST_EMAIL_TEMPLATE = readFileSync(
	join(__dirname, "digest-email.template.html"),
	"utf-8",
);

export interface DigestEmailItem {
	title: string;
	siteName: string;
	/** Owner reader permalink (carries the login marker) — the title's href. */
	readerUrl: string;
	/** Excerpt-sized plain-text teaser; empty when no summary was available. */
	preview: string;
}

/** `utm_medium` is `email`, not the in-site `internal`: the internal-click
 * analytics matches on `internal`, and an email click is not an in-site click. */
function queueCtaUrl(queueUrl: string): string {
	const url = new URL(queueUrl);
	url.searchParams.set("utm_source", "reader-ready-email");
	url.searchParams.set("utm_medium", "email");
	url.searchParams.set("utm_content", "bottom");
	return url.toString();
}

export function buildDigestEmailHtml(params: {
	items: DigestEmailItem[];
	/** Absolute URL of the user's unread queue — the CTA's destination. */
	queueUrl: string;
}): string {
	return render(DIGEST_EMAIL_TEMPLATE, {
		items: params.items,
		queueBottomUrl: queueCtaUrl(params.queueUrl),
		replyLine: EMAIL_REPLY_INVITATION,
		colors: EMAIL_COLORS,
	});
}
