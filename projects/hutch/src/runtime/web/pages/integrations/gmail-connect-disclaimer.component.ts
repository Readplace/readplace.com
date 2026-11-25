import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchIntegrations } from "@packages/translations/hutch-integrations";
import { render, renderConfirmPopover } from "@packages/web-shell";

const { t } = translator(hutchIntegrations, DEFAULT_LOCALE);

const GMAIL_CONNECT_DISCLAIMER_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="POST" action="{{href}}">
	<button class="btn btn--primary" type="submit" data-test-action="gmail-connect-ok" autofocus>{{okLabel}}</button>
</form>`;

export interface GmailConnectDisclaimerAction {
	confirmPopoverId: string;
	href: string;
}

export function renderGmailConnectDisclaimer(action: GmailConnectDisclaimerAction): string {
	return renderConfirmPopover({
		id: action.confirmPopoverId,
		key: action.confirmPopoverId,
		title: t("connectors.gmailDisclaimer.title"),
		body: t("connectors.gmailDisclaimer.body"),
		actionsHtml: render(GMAIL_CONNECT_DISCLAIMER_ACTIONS_TEMPLATE, {
			...action,
			okLabel: t("connectors.gmailDisclaimer.ok"),
		}),
	});
}
