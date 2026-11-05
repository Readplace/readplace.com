import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReaderFailedVariant } from "@packages/article-state-types";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { render } from "@packages/web-shell";
import { isReaderViewReady } from "../../article-state/is-reader-view-ready";
import { prepareReaderContent } from "../reader-slot/reader-content";
import type { ArticleBody } from "@packages/domain/article";
import { type ReaderSectionInput, type SectionPage, sectionHref } from "../reader-slot/section-pages";
import { buildArticleOutline, type OutlineEntry } from "./article-outline";

const TABLE_OF_CONTENTS_TEMPLATE = readFileSync(
	join(__dirname, "table-of-contents.template.html"),
	"utf-8",
);

const CARD_TEMPLATE = readFileSync(join(__dirname, "table-of-contents-card.template.html"), "utf-8");

const LIST_TEMPLATE = readFileSync(join(__dirname, "table-of-contents-list.template.html"), "utf-8");

const EMPTY_TEMPLATE = readFileSync(join(__dirname, "table-of-contents-empty.template.html"), "utf-8");

export const TABLE_OF_CONTENTS_SCRIPT = '<script src="/client-dist/table-of-contents.client.js" defer></script>';

interface TableOfContentsRow {
	anchorId: string;
	label: string;
	href: string;
	page: number;
	children: readonly TableOfContentsRow[];
}

type TableOfContentsState =
	| { kind: "listed"; entries: readonly TableOfContentsRow[] }
	| { kind: "empty" }
	| { kind: "hidden" };

const STATE_CLASS = {
	listed: "table-of-contents--listed",
	empty: "table-of-contents--empty",
	hidden: "table-of-contents--hidden",
} satisfies Record<TableOfContentsState["kind"], string>;

export function isTableOfContentsVisible(input: {
	crawl: ArticleCrawl | undefined;
	content: string | undefined;
	notice: ReaderFailedVariant | undefined;
}): boolean {
	return input.notice === undefined && isReaderViewReady({ crawl: input.crawl, content: input.content });
}

function rowFor(input: { entry: OutlineEntry; page: SectionPage; readerPath: string }): TableOfContentsRow {
	const { entry, page } = input;
	const children = entry.children.map((child) => rowFor({ ...input, entry: child }));
	if (page.kind === "whole") return { ...entry, href: `#${entry.anchorId}`, page: 1, children };
	const entryPage = page.pageOfAnchor.get(entry.anchorId);
	assert(entryPage !== undefined, "every outline entry is an id inside the paged body");
	const href =
		entryPage === page.pager.current
			? `#${entry.anchorId}`
			: sectionHref({ readerPath: input.readerPath, section: entryPage, anchorId: entry.anchorId });
	return { ...entry, href, page: entryPage, children };
}

function resolveState(input: {
	crawl: ArticleCrawl | undefined;
	content: ArticleBody | undefined;
	notice: ReaderFailedVariant | undefined;
	appOrigin: string;
	title: string | undefined;
	url: string;
	readerSection: ReaderSectionInput;
}): TableOfContentsState {
	if (!isTableOfContentsVisible(input)) return { kind: "hidden" };
	assert(input.content !== undefined, "a ready reader view always carries its content");
	const page = prepareReaderContent({
		content: input.content,
		appOrigin: input.appOrigin,
		url: input.url,
		section: input.readerSection,
	});
	const html = page.kind === "paged" ? page.wholeHtml : page.html;
	const entries = buildArticleOutline({ html, title: input.title }).map((entry) =>
		rowFor({ entry, page, readerPath: input.readerSection.readerPath }),
	);
	return entries.length > 0 ? { kind: "listed", entries } : { kind: "empty" };
}

function renderCard(bodyHtml: string): string {
	return render(CARD_TEMPLATE, { bodyHtml }).trim();
}

function cardHtmlFor(state: TableOfContentsState): string {
	switch (state.kind) {
		case "listed":
			return renderCard(render(LIST_TEMPLATE, { entries: state.entries }).trim());
		case "empty":
			return renderCard(render(EMPTY_TEMPLATE, {}).trim());
		case "hidden":
			return "";
	}
}

export function renderTableOfContents(input: {
	crawl: ArticleCrawl | undefined;
	content: ArticleBody | undefined;
	notice: ReaderFailedVariant | undefined;
	appOrigin: string;
	title: string | undefined;
	url: string;
	readerSection: ReaderSectionInput;
	oob: boolean;
}): string {
	const state = resolveState(input);
	return render(TABLE_OF_CONTENTS_TEMPLATE, {
		state: state.kind,
		stateClass: STATE_CLASS[state.kind],
		oob: input.oob,
		cardHtml: cardHtmlFor(state),
	}).trim();
}
