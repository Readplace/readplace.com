import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { LEGAL_PAGE_STYLES } from "../privacy/privacy.styles";

const TERMS_TEMPLATE = readFileSync(join(__dirname, "terms.template.html"), "utf-8");

export function TermsPage(): PageBody {
	return {
		seo: {
			title: "Terms of Service — Readplace",
			description:
				"Terms governing your use of the Readplace read-it-later service.",
			canonicalUrl: "https://readplace.com/terms",
			robots: "noindex, follow",
		},
		styles: LEGAL_PAGE_STYLES,
		bodyClass: "page-terms",
		content: render(TERMS_TEMPLATE, {}),
	};
}
