import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "./email-colors";
import { render } from "@packages/web-shell";

const DIGEST_EMAIL_TEMPLATE = readFileSync(
	join(__dirname, "digest-email.template.html"),
	"utf-8",
);

export interface DigestEmailItem {
	title: string;
	siteName: string;
	/** Owner reader permalink (carries the login marker) for this article. */
	continueReadingUrl: string;
	/** Bounded plain-text reader preview; empty when no content was available. */
	preview: string[];
}

export function buildDigestEmailHtml({ items }: { items: DigestEmailItem[] }): string {
	return render(DIGEST_EMAIL_TEMPLATE, {
		items,
		colors: EMAIL_COLORS,
	});
}
