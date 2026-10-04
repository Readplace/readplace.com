import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { INTEGRATIONS_PATH } from "./gmail-connect.url";
import { INTEGRATIONS_INDEX_STYLES } from "./integrations-index.styles";
import type { IntegrationsIndexViewModel } from "./integrations-index.viewmodel";

const INTEGRATIONS_INDEX_TEMPLATE = readFileSync(
	join(__dirname, "integrations-index.template.html"),
	"utf-8",
);

const INTEGRATIONS_COPY_SCRIPT = `<script src="/client-dist/integrations.client.js" defer></script>`;

export function IntegrationsIndexPage(vm: IntegrationsIndexViewModel): PageBody {
	return {
		seo: {
			title: "Integrations — Readplace",
			description: "Choose where your newsletters come from.",
			canonicalUrl: INTEGRATIONS_PATH,
			robots: "noindex, nofollow",
		},
		styles: INTEGRATIONS_INDEX_STYLES,
		bodyClass: "page-integrations",
		content: { html: render(INTEGRATIONS_INDEX_TEMPLATE, {
			...vm,
			alertsHtml: vm.alerts.map(({ key, message }) => renderAlert({ key, content: { variant: "error", message: { text: message } } })).join(""),
			noticesHtml: vm.notices.map(({ key, message }) => renderAlert({ key, content: { variant: "info", message: { text: message } } })).join(""),
		}) },
		scripts: INTEGRATIONS_COPY_SCRIPT,
	};
}
