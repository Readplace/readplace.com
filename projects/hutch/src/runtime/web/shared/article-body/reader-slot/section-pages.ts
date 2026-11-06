import assert from "node:assert";
import { isChapterSectionId, isPrivateItemUrl } from "@packages/domain/article";
import { withInternalTracking } from "@packages/web-shell";
import { parseHTML } from "linkedom";
import { z } from "zod";

export const READER_SECTION_PAGE_THRESHOLD_BYTES = 5_380_000;

const ReaderSectionQuery = z.coerce.number().int().min(1).optional();

export type ReaderSectionRequest = z.infer<typeof ReaderSectionQuery>;

export interface ReaderSectionInput {
	requested: ReaderSectionRequest;
	readerPath: string;
}

type ReaderSectionSplit = "every-heading" | "chapter-headings";

export function requestedReaderSection(value: unknown): ReaderSectionRequest {
	const parsed = ReaderSectionQuery.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}

export function readerSectionSplitFor(url: string): ReaderSectionSplit {
	return isPrivateItemUrl(url) ? "chapter-headings" : "every-heading";
}

interface SectionPager {
	current: number;
	total: number;
	previousHref: string | undefined;
	nextHref: string | undefined;
}

export type SectionPage =
	| { kind: "whole"; html: string }
	| {
			kind: "paged";
			html: string;
			wholeHtml: string;
			pager: SectionPager;
			pageOfAnchor: ReadonlyMap<string, number>;
		};

const SECTION_LINK_ATTRIBUTES = {
	"hx-boost": "true",
	"hx-target": "main",
	"hx-select": "main",
	"hx-swap": "outerHTML show:none",
};

const PARSE_ORIGIN = "https://readplace.invalid";

export function sectionHref(input: { readerPath: string; section: number; anchorId: string | undefined }): string {
	const url = new URL(input.readerPath, PARSE_ORIGIN);
	url.searchParams.set("section", String(input.section));
	url.hash = input.anchorId ?? "";
	return withInternalTracking(`${url.pathname}${url.search}${url.hash}`, {
		source: "reader",
		content: "section-pager",
	});
}

function pageStartsIn(input: { root: Element; split: ReaderSectionSplit }): ReadonlySet<Node> {
	const headings = Array.from(input.root.children).filter((element) => element.nodeName === "H2");
	if (input.split === "every-heading") return new Set<Node>(headings);
	return new Set<Node>(headings.filter((heading) => isChapterSectionId(heading.id)));
}

function withoutLoneWrappers(element: Element): Element {
	const [onlyChild] = element.children;
	const wrapsEverything = element.children.length === 1 && onlyChild.textContent.trim() === element.textContent.trim();
	return wrapsEverything ? withoutLoneWrappers(onlyChild) : element;
}

export function pageReaderSections(input: {
	html: string;
	section: ReaderSectionInput;
	split: ReaderSectionSplit;
	thresholdBytes: number;
}): SectionPage {
	if (Buffer.byteLength(input.html) <= input.thresholdBytes) return { kind: "whole", html: input.html };
	const { document } = parseHTML(
		`<!DOCTYPE html><html><body><div id="reader-section-pages-root">${input.html}</div></body></html>`,
	);
	const wrapper = document.querySelector("div#reader-section-pages-root");
	assert(wrapper, "parseHTML must produce the reader-section-pages wrapper div");
	const root = withoutLoneWrappers(wrapper);
	const pages: Element[] = [document.createElement("div")];
	const pageStarts = pageStartsIn({ root, split: input.split });
	let firstHeadingSeen = false;
	for (const node of Array.from(root.childNodes)) {
		if (pageStarts.has(node)) {
			if (firstHeadingSeen) pages.push(document.createElement("div"));
			firstHeadingSeen = true;
		}
		pages[pages.length - 1].appendChild(node);
	}
	if (pages.length === 1) return { kind: "whole", html: input.html };

	const pageOfAnchor = new Map<string, number>();
	pages.forEach((page, index) => {
		for (const element of Array.from(page.querySelectorAll("[id]"))) pageOfAnchor.set(element.id, index + 1);
	});
	const total = pages.length;
	const requested = input.section.requested ?? 1;
	const current = requested <= total ? requested : 1;
	const { readerPath } = input.section;
	const page = pages[current - 1];
	for (const link of Array.from(page.querySelectorAll('a[href^="#"]'))) {
		const anchorId = String(link.getAttribute("href")).slice(1);
		const targetPage = pageOfAnchor.get(anchorId);
		if (targetPage === undefined || targetPage === current) continue;
		link.setAttribute("href", sectionHref({ readerPath, section: targetPage, anchorId }));
		for (const [name, value] of Object.entries(SECTION_LINK_ATTRIBUTES)) link.setAttribute(name, value);
	}
	return {
		kind: "paged",
		html: page.innerHTML,
		wholeHtml: input.html,
		pageOfAnchor,
		pager: {
			current,
			total,
			previousHref: current > 1 ? sectionHref({ readerPath, section: current - 1, anchorId: undefined }) : undefined,
			nextHref: current < total ? sectionHref({ readerPath, section: current + 1, anchorId: undefined }) : undefined,
		},
	};
}
