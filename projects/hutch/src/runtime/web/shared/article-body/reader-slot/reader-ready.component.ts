import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeArticleHtml } from "@packages/domain/article";
import { render } from "@packages/web-shell";
import { keepSameHostLinksInSamePage } from "./same-host-links";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-ready.template.html"),
	"utf-8",
);

export interface ReaderReadyInput {
	content: string;
	oob?: boolean;
	appOrigin: string;
}

export function renderReaderReady(input: ReaderReadyInput): string {
	const retargeted = keepSameHostLinksInSamePage({
		html: input.content,
		appHost: new URL(input.appOrigin).host,
	});
	return render(TEMPLATE, {
		content: sanitizeArticleHtml(retargeted),
		oob: input.oob === true,
	});
}
