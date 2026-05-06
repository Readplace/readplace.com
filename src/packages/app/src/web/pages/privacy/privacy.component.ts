import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { LEGAL_PAGE_STYLES } from "./privacy.styles";

const PRIVACY_TEMPLATE = readFileSync(join(__dirname, "privacy.template.html"), "utf-8");

export function PrivacyPage(): PageBody {
	return {
		seo: {
			title: "Privacy Policy — Readplace",
			description:
				"How Readplace handles your data. I collect only what's necessary to run the service and never sell your information.",
			canonicalUrl: "https://readplace.com/privacy",
			robots: "noindex, follow",
		},
		styles: LEGAL_PAGE_STYLES,
		bodyClass: "page-privacy",
		content: render(PRIVACY_TEMPLATE, {}),
	};
}
