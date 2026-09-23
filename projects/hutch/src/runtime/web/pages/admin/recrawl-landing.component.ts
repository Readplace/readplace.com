import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type PageBody, render } from "@packages/web-shell";
import { RECRAWL_STYLES } from "./recrawl.styles";

const TEMPLATE = readFileSync(join(__dirname, "recrawl-landing.template.html"), "utf-8");

export function AdminRecrawlLandingPage(): PageBody {
	return {
		seo: {
			title: "Admin recrawl | Readplace",
			description: "Operator endpoint. Not for public consumption.",
			canonicalUrl: "/admin/recrawl",
			robots: "noindex, nofollow",
		},
		styles: RECRAWL_STYLES,
		bodyClass: "page-admin-recrawl",
		content: { html: render(TEMPLATE, {}) },
	};
}
