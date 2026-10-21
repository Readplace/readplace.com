import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iconSvg } from "@packages/ui-icons";
import { render, renderConfirmPopover, renderInFlightDots } from "@packages/web-shell";
import { CLIENT_ICON_SVG } from "../../shared/client-icons";
import type {
	ConnectedAppDialog,
	ConnectedAppLogo,
	ConnectedAppRow,
	ConnectedAppSignIn,
	ConnectedAppsSectionViewModel,
} from "./account-connected-apps.view-model";

const CONNECTED_APPS_TEMPLATE = readFileSync(join(__dirname, "account-connected-apps.template.html"), "utf-8");

const LOADER_HTML = renderInFlightDots("account__action-loader in-flight-dots");

const DISCONNECT_ACTIONS_TEMPLATE =
	'<form method="POST" action="{{href}}" class="confirm-popover__actions confirm-popover__buttons" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none" data-test-connected-app-action="disconnect-confirm"><button type="button" class="btn btn--neutral" popovertarget="{{id}}" popovertargetaction="hide" data-test-action="disconnect-app-cancel">Cancel</button><button type="submit" class="btn btn--primary" data-test-action="disconnect-app-confirm" autofocus><span class="account__action-label">Sign out from all devices</span>{{{loaderHtml}}}</button></form>';

const SIGN_IN_TEMPLATE =
	'{{#if device}}{{device}} · {{/if}}{{#if location}}{{location}} · {{/if}}Signed in <time datetime="{{at.iso}}" data-local-time="{{at.mode}}">{{at.label}}</time>';

function signInHtml(signIn: ConnectedAppSignIn | undefined): string {
	return signIn === undefined ? "" : render(SIGN_IN_TEMPLATE, signIn);
}

function logoHtml(logo: ConnectedAppLogo): string {
	return logo === "plug" ? iconSvg("plug") : CLIENT_ICON_SVG[logo];
}

function toTemplateRow(row: ConnectedAppRow) {
	return {
		...row,
		logoHtml: logoHtml(row.logo),
		signInHtml: signInHtml(row.signIn),
		disconnects: row.disconnects.map((disconnect) => ({
			...disconnect,
			title: row.title,
			description: row.description,
			loaderHtml: LOADER_HTML,
		})),
	};
}

function renderDisconnectDialog(dialog: ConnectedAppDialog): string {
	return renderConfirmPopover({
		id: dialog.id,
		key: "disconnect-app",
		subject: dialog.clientId,
		title: dialog.title,
		lead: dialog.lead,
		body: dialog.body,
		actionsHtml: render(DISCONNECT_ACTIONS_TEMPLATE, { id: dialog.id, href: dialog.href, loaderHtml: LOADER_HTML }),
	});
}

export function renderConnectedApps(section: ConnectedAppsSectionViewModel): string {
	return render(CONNECTED_APPS_TEMPLATE, {
		state: section.state,
		rows: section.rows.map(toTemplateRow),
		dialogsHtml: section.dialogs.map(renderDisconnectDialog).join(""),
	});
}
