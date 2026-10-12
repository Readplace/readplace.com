import assert from "node:assert";
import { ARTICLE_SECTION_ID_PREFIX } from "@packages/domain/article";
import { parseHTML } from "linkedom";

export interface ArticleSection {
	anchorId: string;
	text: string;
}

const SLUG_MAX_CODE_POINTS = 60;

function slugOf(text: string): string {
	const slug = text
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-|-$/g, "");
	return Array.from(slug).slice(0, SLUG_MAX_CODE_POINTS).join("").replace(/-$/, "");
}

function mintAnchorId(input: { slug: string; used: Set<string> }): string {
	const base = `${ARTICLE_SECTION_ID_PREFIX}${input.slug}`;
	let anchorId = base;
	for (let suffix = 2; input.used.has(anchorId); suffix++) anchorId = `${base}-${suffix}`;
	input.used.add(anchorId);
	return anchorId;
}

export function anchorArticleSections(html: string): {
	html: string;
	sections: readonly ArticleSection[];
} {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><body><div id="reader-section-anchors-root">${html}</div></body></html>`,
	);
	const root = document.querySelector("div#reader-section-anchors-root");
	assert(root, "parseHTML must produce the reader-section-anchors wrapper div");
	const headings: Element[] = Array.from(root.querySelectorAll("h2, h3"));
	const used = new Set<string>();
	const sections: ArticleSection[] = [];
	for (const heading of headings) {
		const text = heading.textContent.replace(/\s+/g, " ").trim();
		if (text === "") {
			heading.removeAttribute("id");
			continue;
		}
		const slug = slugOf(text);
		const anchorId = mintAnchorId({
			slug: slug === "" ? String(sections.length + 1) : slug,
			used,
		});
		heading.setAttribute("id", anchorId);
		sections.push({ anchorId, text });
	}
	return { html: root.innerHTML, sections };
}
