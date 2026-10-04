import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert, renderConfirmPopover } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { INTEGRATIONS_PATH } from "./gmail-connect.url";
import { INTEGRATIONS_INDEX_STYLES } from "./integrations-index.styles";
import type { IntegrationActionViewModel, IntegrationsIndexViewModel } from "./integrations-index.viewmodel";

const INTEGRATIONS_INDEX_TEMPLATE = readFileSync(
	join(__dirname, "integrations-index.template.html"),
	"utf-8",
);

const GMAIL_CONNECT_DISCLAIMER_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="POST" action="{{href}}">
	<input type="hidden" name="utm_source" value="{{trackSource}}">
	<input type="hidden" name="utm_medium" value="internal">
	<input type="hidden" name="utm_content" value="{{trackContent}}">
	<button class="btn btn--primary" type="submit" data-test-action="gmail-connect-ok">OK</button>
</form>`;

function renderGmailConnectDisclaimer(action: IntegrationActionViewModel & { confirmPopoverId: string }): string {
	return renderConfirmPopover({
		id: action.confirmPopoverId,
		key: action.confirmPopoverId,
		title: "Gmail integration is experimental",
		body: "Readplace only reads your newsletters: it never sends, changes or deletes your email. It adds one filter to forward the senders you choose.",
		actionsHtml: render(GMAIL_CONNECT_DISCLAIMER_ACTIONS_TEMPLATE, action),
	});
}

function hasConfirmPopover(
	action: IntegrationActionViewModel,
): action is IntegrationActionViewModel & { confirmPopoverId: string } {
	return action.confirmPopoverId !== undefined;
}

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
			disclaimersHtml: vm.services
				.flatMap((service) => service.actions)
				.filter(hasConfirmPopover)
				.map(renderGmailConnectDisclaimer)
				.join(""),
			noticesHtml: vm.notices.map(({ key, message }) => renderAlert({ key, content: { variant: "info", message: { text: message } } })).join(""),
		}) },
		scripts: INTEGRATIONS_COPY_SCRIPT,
	};
}
