import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { NOT_FOUND_STYLES } from "./not-found.styles";

const NOT_FOUND_TEMPLATE = readFileSync(join(__dirname, "not-found.template.html"), "utf-8");

export function NotFoundPage(): PageBody {
	return {
		seo: {
			title: "Page Not Found — Readplace",
			description: "The page you are looking for does not exist.",
			canonicalUrl: "https://readplace.com",
			robots: "noindex, nofollow",
		},
		styles: NOT_FOUND_STYLES,
		bodyClass: "page-not-found",
		content: render(NOT_FOUND_TEMPLATE, {}),
		statusCode: 404,
	};
}
