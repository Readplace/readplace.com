import { render, renderConfirmPopover } from "@packages/web-shell";

const GMAIL_CONNECT_DISCLAIMER_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="POST" action="{{href}}">
	<button class="btn btn--primary" type="submit" data-test-action="gmail-connect-ok" autofocus>OK</button>
</form>`;

export interface GmailConnectDisclaimerAction {
	confirmPopoverId: string;
	href: string;
}

export function renderGmailConnectDisclaimer(action: GmailConnectDisclaimerAction): string {
	return renderConfirmPopover({
		id: action.confirmPopoverId,
		key: action.confirmPopoverId,
		title: "Gmail integration is experimental",
		body: "Readplace never sends or deletes your email. It adds one filter to forward the senders you choose, replacing any filter that already forwards to a Gmail forwarding address Readplace gave you. To list your senders, it reads only the sender, labels and date of your emails, including new ones while Gmail stays connected. It downloads past emails or marks them as read only when you ask it to.",
		actionsHtml: render(GMAIL_CONNECT_DISCLAIMER_ACTIONS_TEMPLATE, action),
	});
}
