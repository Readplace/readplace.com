import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { LEGAL_PAGE_STYLES } from "../privacy/privacy.styles";

const SUPPORT_TEMPLATE = readFileSync(join(__dirname, "support.template.html"), "utf-8");

export function SupportPage(): PageBody {
	return {
		seo: {
			title: "Support — Readplace",
			description:
				"Get help with Readplace, the read-it-later app: contact and support.",
			canonicalUrl: "https://readplace.com/support",
			robots: "noindex, follow",
		},
		styles: LEGAL_PAGE_STYLES,
		bodyClass: "page-support",
		content: { html: render(SUPPORT_TEMPLATE, {}) },
	};
}
