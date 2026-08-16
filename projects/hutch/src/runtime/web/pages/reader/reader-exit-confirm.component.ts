import { render, renderConfirmPopover } from "@packages/web-shell";

const READER_EXIT_CONFIRM_ID = "reader-exit-confirm";

const EXIT_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions" method="POST" action="{{postUrl}}" data-exit-confirm-form>
	<input type="hidden" name="status" value="read">
	<button class="btn btn--primary" type="submit" data-test-action="exit-confirm-yes">Yes, Mark as Read</button>
	<button class="btn btn--secondary" type="button" data-exit-confirm-decline data-test-action="exit-confirm-no">No, Continue and Keep Unread</button>
</form>`;

export function renderExitConfirm(input: { title: string; postUrl: string }): string {
	return renderConfirmPopover({
		id: READER_EXIT_CONFIRM_ID,
		key: "exit-confirm",
		title: "You're leaving this article",
		lead: { text: input.title, screenReaderOnly: false },
		body: "Did you read it?",
		actionsHtml: render(EXIT_CONFIRM_ACTIONS_TEMPLATE, { postUrl: input.postUrl }),
	});
}
