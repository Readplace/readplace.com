import { render, renderConfirmPopover } from "@packages/web-shell";

export const SHARING_OFF_POPOVER_ID = "reader-sharing-off";

const SHARING_OFF_TITLE = "Sharing and EPUB download are off";

const SHARING_OFF_BODY =
	"This issue is an email sent to you, so only you can open it. It has no public link to share or download.";

const SHARING_OFF_ACTIONS_TEMPLATE = `<div class="confirm-popover__actions confirm-popover__buttons">
	<button class="btn btn--neutral" type="button" popovertarget="{{id}}" popovertargetaction="hide" data-test-action="sharing-off-close" autofocus>Close</button>
</div>`;

const SHARING_OFF_NOTE_TEMPLATE = `<div class="article-body__sharing-off-note">
	<p class="confirm-popover__title">{{title}}</p>
	<p class="confirm-popover__body">{{body}}</p>
</div>`;

export function renderSharingOffDialog(): string {
	return renderConfirmPopover({
		id: SHARING_OFF_POPOVER_ID,
		key: "sharing-off",
		title: SHARING_OFF_TITLE,
		body: SHARING_OFF_BODY,
		actionsHtml: render(SHARING_OFF_ACTIONS_TEMPLATE, { id: SHARING_OFF_POPOVER_ID }),
	});
}

export function renderSharingOffNote(): string {
	return render(SHARING_OFF_NOTE_TEMPLATE, { title: SHARING_OFF_TITLE, body: SHARING_OFF_BODY });
}
