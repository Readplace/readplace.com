import parseSrcset from "parse-srcset";
import { isProvenTrackingImageUrl } from "@packages/crawl-article";
import { ASSOCIATION_MAX_TOKENS } from "./section-thresholds";
import { isElement, isText, ownedChildren, tagOf } from "./owned-nodes";
import { tokenCount } from "./text-keys";

export type Block =
	| { kind: "text"; text: string }
	| { kind: "heading"; text: string }
	| { kind: "code"; text: string }
	| { kind: "cell"; rowKey: string; header: string; value: string }
	| { kind: "image"; urls: readonly string[] };

const INLINE_TAGS = new Set([
	"a",
	"abbr",
	"b",
	"bdi",
	"bdo",
	"big",
	"cite",
	"code",
	"data",
	"del",
	"dfn",
	"em",
	"font",
	"i",
	"ins",
	"kbd",
	"label",
	"mark",
	"q",
	"s",
	"samp",
	"small",
	"span",
	"strike",
	"strong",
	"sub",
	"sup",
	"time",
	"tt",
	"u",
	"var",
	"wbr",
]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const LAZY_SRC_ATTRIBUTES = ["data-src", "data-lazy-src", "data-original"];

export function isHeading(el: Element): boolean {
	return HEADING_TAGS.has(tagOf(el));
}

function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function srcsetUrls(value: string | null): readonly string[] {
	return value === null ? [] : parseSrcset(value).map((entry) => entry.url);
}

function rawImageUrls(img: Element): readonly string[] {
	const lazy = LAZY_SRC_ATTRIBUTES.flatMap((name) => {
		const value = img.getAttribute(name);
		return value === null ? [] : [value];
	});
	const lazySrcset = srcsetUrls(img.getAttribute("data-srcset"));
	if (lazy.length > 0 || lazySrcset.length > 0) {
		return [...lazy, ...lazySrcset];
	}
	const src = img.getAttribute("src");
	return [...(src === null ? [] : [src]), ...srcsetUrls(img.getAttribute("srcset"))];
}

function absoluteImageUrl(params: { raw: string; documentUrl: string | undefined }): readonly string[] {
	try {
		const url = new URL(params.raw, params.documentUrl);
		url.hash = "";
		const keep = (url.protocol === "http:" || url.protocol === "https:") && !isProvenTrackingImageUrl(url.href);
		return keep ? [url.href] : [];
	} catch {
		return [];
	}
}

export function imageUrls(params: { el: Element; documentUrl: string | undefined }): readonly string[] {
	const { el } = params;
	const raw =
		tagOf(el) === "picture"
			? [
					...[...el.querySelectorAll("source")].flatMap((source) => srcsetUrls(source.getAttribute("srcset"))),
					...[...el.querySelectorAll("img")].flatMap(rawImageUrls),
				]
			: rawImageUrls(el);
	return [...new Set(raw.flatMap((url) => absoluteImageUrl({ raw: url, documentUrl: params.documentUrl })))];
}

function tableRows(table: Element): readonly Element[] {
	return [...table.querySelectorAll("tr")].filter((row) => row.closest("table") === table);
}

type WalkParams = { documentUrl: string | undefined; isOwned: (el: Element) => boolean };

function cellText(params: WalkParams & { cell: Element }): string {
	return walkNodes({ nodes: [...params.cell.childNodes], documentUrl: params.documentUrl, isOwned: params.isOwned })
		.flatMap((block) => ("text" in block ? [block.text] : []))
		.join(" ");
}

function cellBlocks(params: WalkParams & { table: Element }): readonly Block[] {
	const { table } = params;
	const [first, ...rest] = tableRows(table);
	const headerRow = first === undefined ? [] : ownedChildren(first);
	if (headerRow.filter((cell) => tagOf(cell) === "th").length < 2 || rest.length === 0) {
		return [];
	}
	return rest.flatMap((row) => {
		const [keyCell, ...valueCells] = ownedChildren(row);
		if (keyCell === undefined) {
			return [];
		}
		const rowKey = cellText({ ...params, cell: keyCell });
		return valueCells.flatMap((cell, index): readonly Block[] => {
			const headerCell = headerRow[index + 1];
			if (headerCell === undefined || tagOf(headerCell) !== "th") {
				return [];
			}
			const value = cellText({ ...params, cell });
			const tokens = tokenCount(value);
			if (tokens < 1 || tokens > ASSOCIATION_MAX_TOKENS) {
				return [];
			}
			return [{ kind: "cell", rowKey, header: cellText({ ...params, cell: headerCell }), value }];
		});
	});
}

function ownedText(params: { node: Node; isOwned: (el: Element) => boolean }): string {
	const { node, isOwned } = params;
	if (isText(node)) {
		return node.data;
	}
	if (!isElement(node) || !isOwned(node)) {
		return "";
	}
	return [...node.childNodes].map((child) => ownedText({ node: child, isOwned })).join("");
}

export function walkNodes(params: {
	nodes: readonly Node[];
	documentUrl: string | undefined;
	isOwned: (el: Element) => boolean;
}): readonly Block[] {
	const blocks: Block[] = [];
	let buffer = "";
	const flush = () => {
		const text = collapse(buffer);
		buffer = "";
		if (text.length > 0) {
			blocks.push({ kind: "text", text });
		}
	};
	const visit = (node: Node) => {
		if (isText(node)) {
			buffer += node.data;
			return;
		}
		if (!isElement(node) || !params.isOwned(node)) {
			return;
		}
		const tag = tagOf(node);
		if (tag === "pre" || isHeading(node)) {
			flush();
			blocks.push({ kind: tag === "pre" ? "code" : "heading", text: collapse(ownedText({ node, isOwned: params.isOwned })) });
			return;
		}
		if (tag === "img" || tag === "picture") {
			const urls = imageUrls({ el: node, documentUrl: params.documentUrl });
			if (urls.length > 0) {
				blocks.push({ kind: "image", urls });
			}
			return;
		}
		if (tag === "br") {
			flush();
			return;
		}
		if (INLINE_TAGS.has(tag)) {
			node.childNodes.forEach(visit);
			return;
		}
		flush();
		if (tag === "table") {
			blocks.push(...cellBlocks({ table: node, documentUrl: params.documentUrl, isOwned: params.isOwned }));
		}
		node.childNodes.forEach(visit);
		flush();
	};
	params.nodes.forEach(visit);
	flush();
	return blocks;
}

export function walk(params: {
	root: Element;
	documentUrl: string | undefined;
	isOwned: (el: Element) => boolean;
}): readonly Block[] {
	return walkNodes({ nodes: [...params.root.childNodes], documentUrl: params.documentUrl, isOwned: params.isOwned });
}
