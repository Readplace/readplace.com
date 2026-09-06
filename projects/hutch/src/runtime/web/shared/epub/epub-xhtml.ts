import assert from "node:assert";
import { parseHTML } from "linkedom";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";

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
const SAFE_IMAGE_FILENAME = /^[A-Za-z0-9._-]+$/;

export function embeddableImageFilename(params: {
	src: string;
	imagePrefix: string;
}): string | undefined {
	let pathname: string;
	try {
		pathname = new URL(params.src).pathname;
	} catch {
		return undefined;
	}
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return undefined;
	}
	const prefix = `/${params.imagePrefix}`;
	if (!decoded.startsWith(prefix)) return undefined;
	const filename = decoded.slice(prefix.length);
	if (!SAFE_IMAGE_FILENAME.test(filename)) return undefined;
	return filename;
}

export function collectArticleImages(params: {
	contentHtml: string;
	articleUrl: string;
}): { filename: string; src: string }[] {
	const imagePrefix = ArticleResourceUniqueId.parse(params.articleUrl).toS3ImagePrefix();
	const { document } = parseHTML(`<div id="epub-root">${params.contentHtml}</div>`);
	const images: { filename: string; src: string }[] = [];
	const seen = new Set<string>();
	for (const img of document.querySelectorAll("img")) {
		const src = img.getAttribute("src");
		if (!src) continue;
		const filename = embeddableImageFilename({ src, imagePrefix });
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
	const imagePrefix = ArticleResourceUniqueId.parse(params.articleUrl).toS3ImagePrefix();
	const embedded = new Set(params.embeddedFilenames);
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
		const filename = src === null ? undefined : embeddableImageFilename({ src, imagePrefix });
		if (filename && embedded.has(filename)) img.setAttribute("src", `images/${filename}`);
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
