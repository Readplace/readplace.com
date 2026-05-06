import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMBED_BASE_STYLES } from "./embed-base.styles";
import type { Component } from "../../component.types";
import { HtmlPage } from "../../html-page";
import { render } from "../../render";

const BASE_TEMPLATE = readFileSync(join(__dirname, "embed-base.template.html"), "utf-8");

export interface SeoMetadata {
	title: string;
	description: string;
	canonicalUrl: string;
	robots?: string;
}

export interface EmbedBaseInput {
	seo: SeoMetadata;
	pageStyles: string;
	bodyClass: string;
	content: string;
	scripts?: string;
	appOrigin: string;
}

function renderBaseTemplate(input: EmbedBaseInput): string {
	return render(BASE_TEMPLATE, {
		title: input.seo.title,
		description: input.seo.description,
		canonicalUrl: input.seo.canonicalUrl,
		robots: input.seo.robots ?? "index, follow",
		baseStyles: EMBED_BASE_STYLES,
		pageStyles: input.pageStyles,
		bodyClass: input.bodyClass,
		content: input.content,
		scripts: input.scripts ?? "",
		appOrigin: input.appOrigin,
	});
}

export function EmbedBase(input: EmbedBaseInput): Component {
	return HtmlPage(renderBaseTemplate(input));
}
