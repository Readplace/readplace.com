import assert from "node:assert";
import { parseHTML } from "linkedom";
import { imageFilenameOf } from "./image-filename-of";

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;

const VOID_ELEMENTS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

const DROP_ELEMENTS = ["script", "style", "iframe"];
const DROP_IMAGE_ATTRIBUTES = ["srcset", "sizes", "loading", "decoding"];

export function collectArticleImages(params: {
	contentHtml: string;
	articleUrl: string;
}): { filename: string; src: string }[] {
	const filenameOf = imageFilenameOf(params.articleUrl);
	const { document } = parseHTML(`<div id="epub-root">${params.contentHtml}</div>`);
	const images: { filename: string; src: string }[] = [];
	const seen = new Set<string>();
	for (const img of document.querySelectorAll("img")) {
		const src = img.getAttribute("src");
		if (!src) continue;
		const filename = filenameOf(src);
		if (!filename) continue;
		if (seen.has(filename)) continue;
		seen.add(filename);
		images.push({ filename, src });
	}
	return images;
}

export function articleEpubXhtml(params: {
	contentHtml: string;
	title: string;
	articleUrl: string;
	embeddedFilenames: readonly string[];
}): string {
	return chapterEpubXhtml({
		contentHtml: params.contentHtml,
		title: params.title,
		articleUrl: params.articleUrl,
		imageHrefs: new Map(params.embeddedFilenames.map((filename) => [filename, `images/${filename}`])),
	});
}

export function chapterEpubXhtml(params: {
	contentHtml: string;
	title: string;
	articleUrl: string;
	imageHrefs: ReadonlyMap<string, string>;
}): string {
	const filenameOf = imageFilenameOf(params.articleUrl);
	const { document } = parseHTML(`<div id="epub-root">${params.contentHtml}</div>`);
	const root = document.querySelector("#epub-root");
	assert(root, "epub content root must parse");

	for (const dropped of root.querySelectorAll(DROP_ELEMENTS.join(","))) dropped.remove();
	for (const picture of root.querySelectorAll("picture")) {
		const img = picture.querySelector("img");
		if (img) picture.replaceWith(img);
		else picture.remove();
	}
	for (const img of root.querySelectorAll("img")) {
		for (const attribute of DROP_IMAGE_ATTRIBUTES) img.removeAttribute(attribute);
		const src = img.getAttribute("src");
		const filename = src === null ? undefined : filenameOf(src);
		const href = filename === undefined ? undefined : params.imageHrefs.get(filename);
		if (href) img.setAttribute("src", href);
		else img.remove();
	}

	return xhtmlDocument({ title: params.title, body: serializeChildren(root) });
}

function serializeChildren(node: Node): string {
	let out = "";
	for (const child of Array.from(node.childNodes)) out += serializeNode(child);
	return out;
}

function serializeNode(node: Node): string {
	if (node.nodeType === NODE_ELEMENT) {
		const element = node as Element;
		const tag = element.localName;
		let attrs = "";
		for (const name of element.getAttributeNames()) {
			const value = element.getAttribute(name);
			assert(value !== null, "getAttributeNames only reports present attributes");
			attrs += ` ${name}="${escapeXmlAttribute(value)}"`;
		}
		if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrs} />`;
		return `<${tag}${attrs}>${serializeChildren(element)}</${tag}>`;
	}
	if (node.nodeType === NODE_TEXT) {
		const text = node.textContent;
		assert(text !== null, "a text node always carries text");
		return escapeXmlText(text);
	}
	return "";
}

export function escapeXmlText(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeXmlAttribute(value: string): string {
	return escapeXmlText(value).replaceAll('"', "&quot;");
}

function xhtmlDocument(params: { title: string; body: string }): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeXmlText(params.title)}</title>
</head>
<body>
${params.body}
</body>
</html>`;
}
