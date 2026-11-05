import assert from "node:assert";
import { chapterSectionId } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import type { EpubChapter } from "./epub-chapters";
import { resolveZipPath } from "./xml-elements";

const DROPPED_ELEMENTS = "script, style, img, svg, picture, image";
const EXCERPT_LENGTH = 200;

export type BookBody = { html: string; sectionCount: number; wordCount: number; excerpt: string };

function sectionId(index: number): string {
	return chapterSectionId(index + 1);
}

function isExternal(href: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

export function buildBookBody(chapters: EpubChapter[]): BookBody {
	const sectionByPath = new Map(chapters.map((chapter, index) => [chapter.path, sectionId(index)]));
	const { document } = parseHTML("<!doctype html><html><body></body></html>");
	const toc = document.createElement("ol");
	const sections: string[] = [];
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
		for (const dropped of body.querySelectorAll(DROPPED_ELEMENTS)) dropped.remove();
		for (const anchor of body.querySelectorAll("a[href]")) {
			const href = String(anchor.getAttribute("href"));
			if (isExternal(href)) continue;
			const [file] = href.split("#");
			const target = file === "" ? sectionId(index) : sectionByPath.get(resolveZipPath({ from: chapter.path, href: file }));
			if (target === undefined) anchor.removeAttribute("href");
			else anchor.setAttribute("href", `#${target}`);
		}
		texts.push(body.textContent);
		sections.push(`${heading.outerHTML}${body.innerHTML.trim()}`);
	});

	const text = texts.join(" ").replace(/\s+/g, " ").trim();
	return {
		html: `${toc.outerHTML}${sections.join("")}`,
		sectionCount: chapters.length,
		wordCount: text === "" ? 0 : text.split(" ").length,
		excerpt: text.slice(0, EXCERPT_LENGTH),
	};
}
