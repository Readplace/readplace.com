import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
import type {
	ArticleDestinationUrl,
	DisplayableReadTime,
	SiteLabel,
} from "@packages/domain/article";
import type { ReadlistSlug } from "@packages/domain/readlist";
import { render } from "@packages/web-shell";
import { type LocalTime, toCalendarDate } from "@packages/web-shell/local-time.format";
import { type ReaderProvenance, provenanceLabel, provenanceTitle } from "./provenance-label";

function readHeaderTemplate(name: string): string {
	return readFileSync(join(__dirname, name), "utf-8");
}

const TEMPLATE = readHeaderTemplate("article-header.template.html");
const TITLE_TEMPLATE = readHeaderTemplate("article-header-title.template.html");
const TAGS_TEMPLATE = readHeaderTemplate("article-header-tags.template.html");
const META_TEMPLATE = readHeaderTemplate("article-header-meta.template.html");

const PROVENANCE_SENDER_POPOVER_ID = "article-provenance-sender";

export interface ReaderReadlistTags {
	unassignUrl: string;
	returnTo: string;
	tags: readonly { slug: ReadlistSlug; label: string }[];
}

export interface ArticleHeaderInput {
	title: string;
	siteName: SiteLabel;
	readTime: DisplayableReadTime | undefined;
	url: ArticleDestinationUrl;
	/** Required-undefined rather than optional: every call site has to decide whether it can supply the tag instead
	 * of dropping it by omission. */
	provenance: ReaderProvenance | undefined;
	readlistTags: ReaderReadlistTags | undefined;
	saved: LocalTime | undefined;
	publishedOn: string | undefined;
}

type ArticleHeaderMetadataInput = Omit<ArticleHeaderInput, "readlistTags">;

function renderTitle(input: { title: string; oob: boolean }): string {
	return render(TITLE_TEMPLATE, input);
}

function renderTags(input: { readlistTags: ReaderReadlistTags | undefined; oob: boolean }): string {
	return render(TAGS_TEMPLATE, input);
}

function renderMeta(input: ArticleHeaderMetadataInput, oob: boolean): string {
	const provenance = input.provenance === undefined ? undefined : provenanceLabel(input.provenance);
	return render(META_TEMPLATE, {
		siteName: input.siteName,
		readTimeLabel: input.readTime?.label ?? "",
		readTimeEmptyClass: input.readTime ? "" : " article-body__read-time--empty",
		url: input.url,
		provenanceLabel: provenance?.label,
		provenanceIconSvg: provenance?.iconSvg,
		provenanceTitle: provenance === undefined ? undefined : provenanceTitle(provenance),
		provenanceSender: provenance?.sender,
		provenanceFallbackClass: provenance?.sender === undefined ? "" : " sender-popover__fallback",
		provenancePopoverId: PROVENANCE_SENDER_POPOVER_ID,
		saved: input.saved,
		published: input.publishedOn === undefined ? undefined : toCalendarDate({ date: input.publishedOn }),
		oob,
	});
}

export function renderArticleHeader(input: ArticleHeaderInput): string {
	return render(TEMPLATE, {
		titleHtml: renderTitle({ title: input.title, oob: false }),
		tagsHtml: renderTags({ readlistTags: input.readlistTags, oob: false }),
		metaHtml: renderMeta(input, false),
	});
}

export function renderArticleHeaderMetadataOob(input: ArticleHeaderMetadataInput): string {
	return renderTitle({ title: input.title, oob: true }) + renderMeta(input, true);
}

export function renderReaderReadlistTagsOob(readlistTags: ReaderReadlistTags | undefined): string {
	return renderTags({ readlistTags, oob: true });
}

/**
 * `<title>` OOB fragment. htmx matches by id, so the live <title> in the page
 * <head> carries `id="document-title"` and we emit a same-id replacement here.
 * Format is owned by the caller (e.g. "Foo — Readplace Reader" vs "Foo | Reader
 * View") so each reader keeps its existing tab title shape.
 */
export function renderDocumentTitleOob(documentTitle: string): string {
	return `<title id="document-title" hx-swap-oob="outerHTML">${Handlebars.Utils.escapeExpression(documentTitle)}</title>`;
}
