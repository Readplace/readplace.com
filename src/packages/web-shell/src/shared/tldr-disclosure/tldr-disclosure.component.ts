import assert from "node:assert";
import { MAX_EXCERPT_LENGTH } from "@packages/provider-contracts/article-summary";
import { render } from "../../render";
import type { HtmlText, PlainText } from "../../trusted-text";
import { truncateAtWordBoundary } from "../../truncate-at-word-boundary";
import {
	TLDR_DISCLOSURE_TEMPLATE,
	TLDR_HTML_BODY_TEMPLATE,
	TLDR_TEXT_BODY_TEMPLATE,
} from "./tldr-disclosure.template";

export { TLDR_DISCLOSURE_STYLES } from "./tldr-disclosure.styles";

export type TldrBody = { html: HtmlText } | { text: PlainText };

export interface TldrDisclosure {
	body: TldrBody;
	excerpt?: string;
	open: boolean;
	toggleUrl?: string;
}

function rawPreview(input: TldrDisclosure): string {
	if (input.excerpt) return input.excerpt;
	assert("text" in input.body, "an html TL;DR body needs an excerpt");
	const flattened = input.body.text.replace(/\s+/g, " ").trim();
	return truncateAtWordBoundary(flattened, MAX_EXCERPT_LENGTH);
}

function buildPreview(input: TldrDisclosure): string {
	// Strips a trailing ellipsis so it never doubles up with the "view more …" the
	// template appends after the preview.
	return rawPreview(input).replace(/…\s*$/u, "").trimEnd();
}

export function renderTldrDisclosure(input: TldrDisclosure): string {
	const preview = buildPreview(input);
	const bodyHtml = "html" in input.body
		? render(TLDR_HTML_BODY_TEMPLATE, { html: input.body.html })
		: render(TLDR_TEXT_BODY_TEMPLATE, { text: input.body.text });
	return render(TLDR_DISCLOSURE_TEMPLATE, {
		open: input.open,
		toggleUrl: input.toggleUrl,
		preview,
		bodyHtml,
	});
}
