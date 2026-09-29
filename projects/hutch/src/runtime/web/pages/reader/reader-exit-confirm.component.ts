import { render, renderConfirmPopover, renderIllustration } from "@packages/web-shell";

export const READER_EXIT_CONFIRM_SCRIPT = `<script src="/client-dist/reader-exit-confirm.client.js" defer></script>`;

const READER_EXIT_CONFIRM_ID = "reader-exit-confirm";

export const EXIT_CONFIRM_SCOPE = {
	articleBody: ".article-body__content",
	nextReadCard: ".next-read__card",
} as const;

export type ExitConfirmScope =
	(typeof EXIT_CONFIRM_SCOPE)[keyof typeof EXIT_CONFIRM_SCOPE];

export type ExitConfirmScopes = readonly [ExitConfirmScope, ...ExitConfirmScope[]];

const EXIT_CONFIRM_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="POST" action="{{postUrl}}" data-exit-confirm-form data-exit-confirm-scopes="{{scopes}}">
	<input type="hidden" name="status" value="read">
	<button class="btn btn--neutral" type="button" data-exit-confirm-decline data-test-action="exit-confirm-no">No, keep unread</button>
	<button class="btn btn--primary" type="submit" data-test-action="exit-confirm-yes">Yes, mark as read</button>
</form>`;

export function renderExitConfirm(input: {
	title: string;
	postUrl: string;
	scopes: ExitConfirmScopes;
}): string {
	return renderConfirmPopover({
		id: READER_EXIT_CONFIRM_ID,
		key: "exit-confirm",
		title: "Before you leave",
		lead: input.title,
		body: "Did you finish reading it? You can mark it as read now, or keep it unread and come back to it later.",
		illustrationHtml: renderIllustration("book-lightbulb"),
		actionsHtml: render(EXIT_CONFIRM_ACTIONS_TEMPLATE, {
			postUrl: input.postUrl,
			scopes: input.scopes.join(", "),
		}),
	});
}
