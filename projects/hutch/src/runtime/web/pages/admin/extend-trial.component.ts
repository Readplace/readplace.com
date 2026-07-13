import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type PageBody, render } from "@packages/web-shell";
import { EXTEND_TRIAL_STYLES } from "./extend-trial.styles";
import type { ExtendTrialViewModel } from "./extend-trial.view-model";

const TEMPLATE = readFileSync(join(__dirname, "extend-trial.template.html"), "utf-8");

export function AdminExtendTrialPage(
	viewModel: ExtendTrialViewModel,
	options?: { statusCode?: number },
): PageBody {
	return {
		seo: {
			title: "Extend a trial | Readplace",
			description: "Operator endpoint. Not for public consumption.",
			canonicalUrl: "/admin/extend-trial",
			robots: "noindex, nofollow",
		},
		styles: EXTEND_TRIAL_STYLES,
		bodyClass: "page-admin-extend-trial",
		content: { html: render(TEMPLATE, viewModel) },
		statusCode: options?.statusCode,
	};
}
