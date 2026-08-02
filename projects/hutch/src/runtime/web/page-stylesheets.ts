import assert from "node:assert";
import { createHash } from "node:crypto";

export interface PageStylesheet {
	href: string;
	css: string;
}

const stylesheetsByName = new Map<string, PageStylesheet>();

export function addPageStylesheet(entry: { name: string; css: string }): PageStylesheet {
	assert(
		!stylesheetsByName.has(entry.name),
		`page stylesheet "${entry.name}" is already registered`,
	);
	const hash = createHash("sha256").update(entry.css).digest("hex").slice(0, 12);
	const stylesheet: PageStylesheet = { href: `/styles/${entry.name}.${hash}.css`, css: entry.css };
	stylesheetsByName.set(entry.name, stylesheet);
	return stylesheet;
}

export function findPageStylesheetByName(name: string): PageStylesheet | undefined {
	return stylesheetsByName.get(name);
}
