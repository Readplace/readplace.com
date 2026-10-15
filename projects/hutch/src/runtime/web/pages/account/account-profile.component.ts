import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderConfirmPopover } from "@packages/web-shell";
import type { ProfileEdit } from "./account.view-model";

const ACCOUNT_PROFILE_FORM_TEMPLATE = readFileSync(join(__dirname, "account-profile-form.template.html"), "utf-8");

interface ProfileFormButton {
	type: "submit" | "button";
	buttonClass: string;
	testAction: string;
	popoverTargetAttrs: string;
	label: string;
}

function renderProfileForm(
	edit: ProfileEdit,
	form: {
		formClass: string;
		buttonsClass: string;
		formKey: string;
		inputId: string;
		autofocus: boolean;
		buttons: ProfileFormButton[];
	},
): string {
	return render(ACCOUNT_PROFILE_FORM_TEMPLATE, {
		...form,
		action: edit.formAction,
		value: edit.value,
		maxLength: edit.maxLength,
	});
}

export function renderAccountProfileEdit(edit: ProfileEdit): string {
	return renderConfirmPopover({
		id: edit.popoverId,
		key: "account-profile",
		title: "Edit profile",
		body: "Your name replaces your email in the header. Leave it blank to show your email instead.",
		actionsHtml: renderProfileForm(edit, {
			formClass: "confirm-popover__actions account-profile__dialog-form",
			buttonsClass: "confirm-popover__buttons",
			formKey: "account-profile",
			inputId: "account-profile-name",
			autofocus: true,
			buttons: [
				{
					type: "button",
					buttonClass: "btn btn--neutral",
					testAction: "account-profile-cancel",
					popoverTargetAttrs: render(' popovertarget="{{id}}" popovertargetaction="hide"', { id: edit.popoverId }),
					label: "Cancel",
				},
				{
					type: "submit",
					buttonClass: "btn btn--primary",
					testAction: "account-profile-save",
					popoverTargetAttrs: "",
					label: "Save",
				},
			],
		}),
	});
}

export function renderAccountProfileFallbackForm(edit: ProfileEdit): string {
	return renderProfileForm(edit, {
		formClass: "account-profile__fallback",
		buttonsClass: "account-profile__buttons",
		formKey: "account-profile-fallback",
		inputId: "account-profile-name-fallback",
		autofocus: false,
		buttons: [
			{
				type: "submit",
				buttonClass: "btn btn--primary btn--m",
				testAction: "account-profile-fallback-save",
				popoverTargetAttrs: "",
				label: "Save",
			},
		],
	});
}
