import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type PageBody, render, renderAlert } from "@packages/web-shell";
import { ADMIN_NEWSLETTERS_STYLES } from "./admin-newsletters.styles";
import type { AdminNewslettersViewModel } from "./admin-newsletters.viewmodel";

const TEMPLATE = readFileSync(join(__dirname, "admin-newsletters.template.html"), "utf-8");
const FORM_TEMPLATE = readFileSync(join(__dirname, "admin-newsletter-form.template.html"), "utf-8");

const STATUS_MODIFIERS = {
	pending: "admin-newsletters__status--pending",
	approved: "admin-newsletters__status--approved",
	rejected: "admin-newsletters__status--rejected",
} as const;

export function AdminNewslettersPage(viewModel: AdminNewslettersViewModel, options: { statusCode: number }): PageBody {
	const html = render(TEMPLATE, {
		...viewModel,
		noticeAlert: renderAlert({
			key: "newsletter-notice",
			content: viewModel.notice === undefined ? undefined : { variant: "success", message: { text: viewModel.notice } },
		}),
		conflictAlert: renderAlert({
			key: "newsletter-conflict",
			content: viewModel.conflict === undefined ? undefined : { variant: "error", message: { text: viewModel.conflict } },
		}),
		storageAlert: renderAlert({
			key: "newsletter-storage",
			content: viewModel.storageAlert === undefined ? undefined : { variant: "error", message: { text: viewModel.storageAlert } },
		}),
		formHtml: viewModel.form === undefined ? "" : render(FORM_TEMPLATE, viewModel.form),
		emptyFlag: viewModel.empty.isEmpty ? "true" : "false",
		emptyModifier: viewModel.empty.isEmpty ? "" : "admin-newsletters__empty--hidden",
		tableModifier: viewModel.empty.isEmpty ? "admin-newsletters__table--hidden" : "",
		rows: viewModel.rows.map((row) => ({
			...row,
			statusModifier: STATUS_MODIFIERS[row.status],
			nameModifier: row.named ? "" : "admin-newsletters__cell--unnamed",
		})),
	});
	return {
		seo: {
			title: "Newsletters | Admin | Readplace",
			description: "Operator tools. Not for public consumption.",
			canonicalUrl: "/admin/newsletters",
			robots: "noindex, nofollow",
		},
		styles: ADMIN_NEWSLETTERS_STYLES,
		bodyClass: "page-admin-newsletters",
		statusCode: options.statusCode,
		content: { html },
	};
}
