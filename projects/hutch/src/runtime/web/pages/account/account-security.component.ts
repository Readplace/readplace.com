import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AlertContent, type LocalTime, render, renderAlert } from "@packages/web-shell";
import { CONNECTED_APPS_PHRASE } from "../../shared/client-surface-phrases";
import type { SecuritySectionViewModel } from "./account.view-model";

const ACCOUNT_SECURITY_TEMPLATE = readFileSync(join(__dirname, "account-security.template.html"), "utf-8");

const HIDDEN_SECURITY_SECTION =
	'<section class="account-security account-security--hidden" data-test-account-section="security"></section>';

const PASSWORD_CHANGED_ALERT: AlertContent = {
	variant: "success",
	title: { text: "Password changed", element: "p" },
	message: { text: `Other browsers were signed out, and ${CONNECTED_APPS_PHRASE} were disconnected.` },
};

const UPDATED_LINE_CLASS = {
	visible: "account-row__description account-security__updated account-security__updated--visible",
	hidden: "account-row__description account-security__updated account-security__updated--hidden",
} as const;

function updatedLine(updated: LocalTime | undefined): { updatedClass: string; updatedHtml: string } {
	if (updated === undefined) return { updatedClass: UPDATED_LINE_CLASS.hidden, updatedHtml: "" };
	return {
		updatedClass: UPDATED_LINE_CLASS.visible,
		updatedHtml: render(
			'Last updated <time datetime="{{iso}}" data-local-time="{{mode}}" data-test-password-updated>{{label}}</time>.',
			updated,
		),
	};
}

export function renderSecuritySection(section: SecuritySectionViewModel): string {
	if (section.state === "hidden") return HIDDEN_SECURITY_SECTION;
	return render(ACCOUNT_SECURITY_TEMPLATE, {
		changeHref: section.changeHref,
		alertHtml: renderAlert({ key: "password-changed", content: section.changed ? PASSWORD_CHANGED_ALERT : undefined }),
		...updatedLine(section.updated),
	});
}
