import { render, renderConfirmPopover } from "@packages/web-shell";

export const READER_EXIT_CONFIRM_SCRIPT = `<script src="/client-dist/reader-exit-confirm.client.js" defer></script>`;

const READER_EXIT_CONFIRM_ID = "reader-exit-confirm";

export const EXIT_CONFIRM_SCOPE = {
	articleBody: ".article-body__content",
	nextReadCard: ".next-read__card",
} as const;

export type ExitConfirmScope =
	(typeof EXIT_CONFIRM_SCOPE)[keyof typeof EXIT_CONFIRM_SCOPE];

export type ExitConfirmScopes = readonly [ExitConfirmScope, ...ExitConfirmScope[]];

const EXIT_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions" method="POST" action="{{postUrl}}" data-exit-confirm-form data-exit-confirm-scopes="{{scopes}}">
	<input type="hidden" name="status" value="read">
	<button class="btn btn--primary" type="submit" data-test-action="exit-confirm-yes">Yes, Mark as Read</button>
	<button class="btn btn--secondary" type="button" data-exit-confirm-decline data-test-action="exit-confirm-no">No, Continue and Keep Unread</button>
</form>`;

export function renderExitConfirm(input: {
	title: string;
	postUrl: string;
	scopes: ExitConfirmScopes;
}): string {
	return renderConfirmPopover({
		id: READER_EXIT_CONFIRM_ID,
		key: "exit-confirm",
		title: "You're leaving this article",
		lead: { text: input.title, screenReaderOnly: false },
		body: "Did you read it?",
		actionsHtml: render(EXIT_CONFIRM_ACTIONS_TEMPLATE, {
			postUrl: input.postUrl,
			scopes: input.scopes.join(", "),
		}),
	});
}
