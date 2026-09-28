import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type PageBody, render, renderAlert } from "@packages/web-shell";
import { EXTEND_TRIAL_STYLES } from "./extend-trial.styles";
import type { ExtendTrialViewModel } from "./extend-trial.view-model";

const TEMPLATE = readFileSync(join(__dirname, "extend-trial.template.html"), "utf-8");

export function AdminExtendTrialPage(
	viewModel: ExtendTrialViewModel,
	options?: { statusCode?: number },
): PageBody {
	const alertsHtml = [
		viewModel.globalError === undefined ? "" : renderAlert({ key: "global-error", content: { variant: "error", title: { text: viewModel.globalError, element: "p" } } }),
		viewModel.notFound ? renderAlert({ key: "extend-trial-not-found", content: { variant: "error", title: { text: "No account with that email.", element: "p" } } }) : "",
		viewModel.refused ? renderAlert({
			key: "extend-trial-refused",
			content: {
				variant: "error",
				title: { text: "Refused", element: "h2" },
				message: { html: render('<p data-test-extend-trial-refusal>{{refusalMessage}}</p><dl class="admin-extend-trial__facts admin-extend-trial__refusal-facts"><dt>Current status</dt><dd data-test-extend-trial-status>{{status}}</dd></dl>', viewModel) },
			},
		}) : "",
	].join("");
	return {
		seo: {
			title: "Extend a trial | Readplace",
			description: "Operator endpoint. Not for public consumption.",
			canonicalUrl: "/admin/extend-trial",
			robots: "noindex, nofollow",
		},
		styles: EXTEND_TRIAL_STYLES,
		bodyClass: "page-admin-extend-trial",
		content: { html: render(TEMPLATE, { ...viewModel, alertsHtml }) },
		statusCode: options?.statusCode,
	};
}
