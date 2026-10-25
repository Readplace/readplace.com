import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { SIREN_MEDIA_TYPE } from "../../api/siren";

import { DEVELOPERS_STYLES } from "./developers.styles";

const DEVELOPERS_TEMPLATE = readFileSync(join(__dirname, "developers.template.html"), "utf-8");

const ORIGIN = "https://readplace.com";
const CANONICAL_URL = `${ORIGIN}/developers`;

const DEVELOPERS_TITLE = "Build on the Readplace API";

const DEVELOPERS_DESCRIPTION =
	"Register an OAuth client, discover the Siren API from one URL, then save, list, read and file a reader's articles.";

export function DevelopersPage(): PageBody {
	return {
		seo: {
			title: `${DEVELOPERS_TITLE} — Readplace`,
			description: DEVELOPERS_DESCRIPTION,
			canonicalUrl: CANONICAL_URL,
			robots: "noindex",
			structuredData: [
				{
					"@context": "https://schema.org",
					"@type": "WebPage",
					"@id": CANONICAL_URL,
					name: DEVELOPERS_TITLE,
					url: CANONICAL_URL,
					description: DEVELOPERS_DESCRIPTION,
					isPartOf: { "@type": "WebSite", name: "Readplace", url: ORIGIN },
					about: { "@id": `${ORIGIN}/#app` },
				},
			],
		},
		styles: DEVELOPERS_STYLES,
		bodyClass: "page-developers",
		content: {
			html: render(DEVELOPERS_TEMPLATE, { sirenMediaType: SIREN_MEDIA_TYPE }),
		},
	};
}
