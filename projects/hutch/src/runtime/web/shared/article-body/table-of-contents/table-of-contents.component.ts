import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReaderFailedVariant } from "@packages/article-state-types";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { render } from "@packages/web-shell";
import { isReaderViewReady } from "../../article-state/is-reader-view-ready";
import { prepareReaderContent } from "../reader-slot/reader-content";
import type { ArticleSection } from "../reader-slot/section-anchors";
import type { ArticleBody } from "@packages/domain/article";

const TABLE_OF_CONTENTS_TEMPLATE = readFileSync(
	join(__dirname, "table-of-contents.template.html"),
	"utf-8",
);

const CARD_TEMPLATE = readFileSync(join(__dirname, "table-of-contents-card.template.html"), "utf-8");

const LIST_TEMPLATE = readFileSync(join(__dirname, "table-of-contents-list.template.html"), "utf-8");

const EMPTY_TEMPLATE = readFileSync(join(__dirname, "table-of-contents-empty.template.html"), "utf-8");

export const TABLE_OF_CONTENTS_SCRIPT = '<script src="/client-dist/table-of-contents.client.js" defer></script>';

type TableOfContentsState =
	| { kind: "listed"; sections: readonly ArticleSection[] }
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

function resolveState(input: {
	crawl: ArticleCrawl | undefined;
	content: ArticleBody | undefined;
	notice: ReaderFailedVariant | undefined;
	appOrigin: string;
}): TableOfContentsState {
	if (!isTableOfContentsVisible(input)) return { kind: "hidden" };
	assert(input.content !== undefined, "a ready reader view always carries its content");
	const { sections } = prepareReaderContent({ content: input.content, appOrigin: input.appOrigin });
	return sections.length > 0 ? { kind: "listed", sections } : { kind: "empty" };
}

function renderCard(bodyHtml: string): string {
	return render(CARD_TEMPLATE, { bodyHtml }).trim();
}

function cardHtmlFor(state: TableOfContentsState): string {
	switch (state.kind) {
		case "listed":
			return renderCard(render(LIST_TEMPLATE, { sections: state.sections }).trim());
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
