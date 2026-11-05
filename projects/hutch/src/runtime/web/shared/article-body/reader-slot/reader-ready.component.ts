import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { prepareReaderContent } from "./reader-content";
import type { ArticleBody } from "@packages/domain/article";
import type { ReaderSectionInput, SectionPage } from "./section-pages";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-ready.template.html"),
	"utf-8",
);

const PAGER_TEMPLATE = readFileSync(join(__dirname, "reader-section-pager.template.html"), "utf-8");

export interface ReaderReadyInput {
	content: ArticleBody;
	oob?: boolean;
	appOrigin: string;
	url: string;
	readerSection: ReaderSectionInput;
}

function pagerHtmlFor(page: SectionPage): string {
	if (page.kind === "whole") return "";
	return render(PAGER_TEMPLATE, page.pager).trim();
}

export function renderReaderReady(input: ReaderReadyInput): string {
	const page = prepareReaderContent({
		content: input.content,
		appOrigin: input.appOrigin,
		url: input.url,
		section: input.readerSection,
	});
	return render(TEMPLATE, {
		content: page.html,
		pagerHtml: pagerHtmlFor(page),
		oob: input.oob === true,
	});
}
