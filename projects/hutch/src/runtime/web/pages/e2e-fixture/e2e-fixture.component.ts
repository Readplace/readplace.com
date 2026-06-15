import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

const TEMPLATE = readFileSync(join(__dirname, "e2e-fixture.template.html"), "utf-8");

const DEFAULT_TITLE = "Readplace E2E test fixture article";

/** The optional `title` lets a single run save several distinct fixture
 * articles (the queue-flow e2e needs four with different titles) without adding
 * more fixture pages; the long body that drives the summariser is unchanged. */
export function E2EFixturePage(params: { title?: string } = {}): PageBody {
	const title = params.title ?? DEFAULT_TITLE;
	return {
		seo: {
			title,
			description: "Static fixture used by Readplace's end-to-end tests against staging.",
			canonicalUrl: "https://readplace.com/e2e/article/",
			robots: "noindex, nofollow",
		},
		styles: "",
		content: { html: render(TEMPLATE, { title }) },
	};
}
