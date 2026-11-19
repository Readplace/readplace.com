import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";
import { type CspNonce, type PageBody, render } from "@packages/web-shell";
import { autoSubmitScript } from "../../shared/auto-submit-script";
import { VIEW_HIGHLIGHTS_CLAIM_PATH } from "./view-highlights-paths";

const { t } = translator(hutchReader, DEFAULT_LOCALE);

const TEMPLATE = readFileSync(join(__dirname, "view-highlights-claim.template.html"), "utf-8");

const STYLES = readFileSync(join(__dirname, "view-highlights-claim.styles.css"), "utf-8");

export function ViewHighlightsClaimPage(input: { appOrigin: string; cspNonce: CspNonce }): PageBody {
	return {
		seo: {
			title: `${t("view.highlightsClaim.title")} — Readplace`,
			description: t("view.highlightsClaim.body"),
			canonicalUrl: `${input.appOrigin}${VIEW_HIGHLIGHTS_CLAIM_PATH}`,
			robots: "noindex, nofollow",
		},
		styles: STYLES,
		bodyClass: "page-view-highlights-claim",
		content: { html: render(TEMPLATE, { action: VIEW_HIGHLIGHTS_CLAIM_PATH }) },
		scripts: autoSubmitScript(input.cspNonce),
	};
}
