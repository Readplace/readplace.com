import { render, renderConfirmPopover } from "@packages/web-shell";

export const READLIST_PURPOSE_DELETE_ID = "readlist-purpose-delete";

const ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="POST" action="{{action}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none">
	<button class="btn btn--neutral" type="button" popovertarget="{{popoverId}}" popovertargetaction="hide" data-test-action="readlist-purpose-delete-cancel">Cancel</button>
	<button class="btn btn--primary" type="submit" data-test-action="readlist-purpose-delete-confirm">Delete purpose</button>
</form>`;

export function renderPurposeDeleteConfirm(input: { label: string; action: string }): string {
	return renderConfirmPopover({
		id: READLIST_PURPOSE_DELETE_ID,
		key: READLIST_PURPOSE_DELETE_ID,
		title: "Delete this purpose?",
		body: "The readlist and its articles stay. Newsletters saved to it will keep every link until you set a new purpose.",
		lead: `Readlist: ${input.label}`,
		actionsHtml: render(ACTIONS_TEMPLATE, { action: input.action, popoverId: READLIST_PURPOSE_DELETE_ID }),
	});
}
