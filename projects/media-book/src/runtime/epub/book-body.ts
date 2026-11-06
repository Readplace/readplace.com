import assert from "node:assert";
import { chapterSectionId } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import type { EpubChapter } from "./epub-chapters";
import { resolveZipPath } from "./xml-elements";

const DROPPED_ELEMENTS = "script, style, svg, image, source";
const EXCERPT_LENGTH = 200;

export type BookBody = { html: string; sectionCount: number; wordCount: number; excerpt: string };
export type ResolveImage = (zipPath: string) => Promise<string | undefined>;

type BookImage = { element: Element; zipPath: string };

function sectionId(index: number): string {
	return chapterSectionId(index + 1);
}

function isExternal(href: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

function unwrapSvgImages(body: Element): void {
	for (const svg of body.querySelectorAll("svg")) {
		const image = svg.querySelector("image");
		const href = image?.getAttribute("href") ?? image?.getAttribute("xlink:href");
		if (href === null || href === undefined) continue;
		const img = svg.ownerDocument.createElement("img");
		img.setAttribute("src", href);
		svg.replaceWith(img);
	}
}

function bookImagesOf(params: { body: Element; chapterPath: string }): BookImage[] {
	return [...params.body.querySelectorAll("img")].flatMap((element) => {
		const src = element.getAttribute("src") ?? "";
		element.removeAttribute("srcset");
		if (src === "" || isExternal(src) || src.startsWith("/")) {
			element.remove();
			return [];
		}
		return [{ element, zipPath: resolveZipPath({ from: params.chapterPath, href: src.split("#")[0] }) }];
	});
}

function resolveEach(params: { zipPaths: string[]; resolveImage: ResolveImage }): Promise<Map<string, string | undefined>> {
	return params.zipPaths.reduce(
		(resolved, zipPath) => resolved.then((sources) => params.resolveImage(zipPath).then((src) => sources.set(zipPath, src))),
		Promise.resolve(new Map<string, string | undefined>()),
	);
}

export function buildBookBody(params: { chapters: EpubChapter[]; resolveImage: ResolveImage }): Promise<BookBody> {
	const { chapters } = params;
	const sectionByPath = new Map(chapters.map((chapter, index) => [chapter.path, sectionId(index)]));
	const { document } = parseHTML("<!doctype html><html><body></body></html>");
	const toc = document.createElement("ol");
	const bodies: { heading: Element; body: Element }[] = [];
	const images: BookImage[] = [];
	const texts: string[] = [];

	chapters.forEach((chapter, index) => {
		const item = document.createElement("li");
		const link = document.createElement("a");
		link.setAttribute("href", `#${sectionId(index)}`);
		link.textContent = chapter.title;
		item.append(link);
		toc.append(item);

		const heading = document.createElement("h2");
		heading.setAttribute("id", sectionId(index));
		heading.textContent = chapter.title;

		const body = parseHTML(chapter.xhtml).document.querySelector("body");
		assert(body, `chapter ${chapter.path} has no body`);
		unwrapSvgImages(body);
		for (const dropped of body.querySelectorAll(DROPPED_ELEMENTS)) dropped.remove();
		images.push(...bookImagesOf({ body, chapterPath: chapter.path }));
		for (const anchor of body.querySelectorAll("a[href]")) {
			const href = String(anchor.getAttribute("href"));
			if (isExternal(href)) continue;
			const [file] = href.split("#");
			const target = file === "" ? sectionId(index) : sectionByPath.get(resolveZipPath({ from: chapter.path, href: file }));
			if (target === undefined) anchor.removeAttribute("href");
			else anchor.setAttribute("href", `#${target}`);
		}
		texts.push(body.textContent);
		bodies.push({ heading, body });
	});

	return resolveEach({ zipPaths: [...new Set(images.map((image) => image.zipPath))], resolveImage: params.resolveImage }).then((sources) => {
		for (const { element, zipPath } of images) {
			const src = sources.get(zipPath);
			if (src === undefined) {
				element.remove();
				continue;
			}
			element.setAttribute("src", src);
			element.setAttribute("loading", "lazy");
		}
		const text = texts.join(" ").replace(/\s+/g, " ").trim();
		return {
			html: `${toc.outerHTML}${bodies.map(({ heading, body }) => `${heading.outerHTML}${body.innerHTML.trim()}`).join("")}`,
			sectionCount: chapters.length,
			wordCount: text === "" ? 0 : text.split(" ").length,
			excerpt: text.slice(0, EXCERPT_LENGTH),
		};
	});
}
