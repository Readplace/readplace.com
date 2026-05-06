import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { VIEW_LANDING_STYLES } from "./view-landing.styles";

const VIEW_LANDING_TEMPLATE = readFileSync(
	join(__dirname, "view-landing.template.html"),
	"utf-8",
);

export function ViewLandingPage(): PageBody {
	return {
		seo: {
			title: "Reader view — paste a link to read distraction-free | Readplace",
			description:
				"Paste any article URL to open it in Readplace's reader view — clean typography, no ads, no trackers.",
			canonicalUrl: "/view",
			ogType: "website",
			robots: "index, follow",
		},
		styles: VIEW_LANDING_STYLES,
		bodyClass: "page-view-landing",
		content: render(VIEW_LANDING_TEMPLATE, {}),
	};
}
