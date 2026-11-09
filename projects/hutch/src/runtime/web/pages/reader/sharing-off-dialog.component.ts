import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReader } from "@packages/translations/hutch-reader";
import { render, renderConfirmPopover } from "@packages/web-shell";

const { t } = translator(hutchReader, DEFAULT_LOCALE);

export const SHARING_OFF_POPOVER_ID = "reader-sharing-off";

export type SharingOffReason = "email-issue" | "private-upload";

function sharingOffCopy(reason: SharingOffReason): { title: string; body: string } {
	if (reason === "private-upload") {
		return {
			title: t("reader.sharingOff.privateUpload.title"),
			body: t("reader.sharingOff.privateUpload.body"),
		};
	}
	return {
		title: "Sharing and EPUB download are off",
		body: "This issue is an email sent to you, so only you can open it. It has no public link to share or download.",
	};
}

const SHARING_OFF_ACTIONS_TEMPLATE = `<div class="confirm-popover__actions confirm-popover__buttons">
	<button class="btn btn--neutral" type="button" popovertarget="{{id}}" popovertargetaction="hide" data-test-action="sharing-off-close" autofocus>Close</button>
</div>`;

const SHARING_OFF_NOTE_TEMPLATE = `<div class="article-body__sharing-off-note">
	<p class="confirm-popover__title">{{title}}</p>
	<p class="confirm-popover__body">{{body}}</p>
</div>`;

export function renderSharingOffDialog(reason: SharingOffReason): string {
	return renderConfirmPopover({
		id: SHARING_OFF_POPOVER_ID,
		key: "sharing-off",
		...sharingOffCopy(reason),
		actionsHtml: render(SHARING_OFF_ACTIONS_TEMPLATE, { id: SHARING_OFF_POPOVER_ID }),
	});
}

export function renderSharingOffNote(reason: SharingOffReason): string {
	return render(SHARING_OFF_NOTE_TEMPLATE, sharingOffCopy(reason));
}
