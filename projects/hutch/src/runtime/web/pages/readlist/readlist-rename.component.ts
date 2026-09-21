import { READLIST_LABEL_MAX_LENGTH, type ReadlistSlug } from "@packages/domain/readlist";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

import { readlistRenamePath } from "./readlist.url";

export const READLIST_RENAME_FIELD = "label";

export const READLIST_RENAME_SCRIPT =
	'<script src="/client-dist/readlist.client.js" defer></script>';

export function readlistRenamePopoverId(readlist: ReadlistSlug): string {
	return `readlist-rename-${readlist}`;
}

export function readlistRenameFallbackInputId(readlist: ReadlistSlug): string {
	return `readlist-rename-fallback-${readlist}`;
}

export function readlistRenameAction(readlist: ReadlistSlug): string {
	return withInternalTracking(readlistRenamePath(readlist), {
		source: "queue-nav",
		content: "rename-readlist",
	});
}

const RENAME_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions readlist-rename" method="POST" action="{{action}}" data-readlist-rename data-test-form="readlist-rename">
	<label class="readlist-rename__label" for="{{inputId}}">Readlist Name</label>
	<input class="readlist-rename__input" id="{{inputId}}" type="text" name="{{field}}" value="{{label}}" maxlength="{{maxLength}}" required autocomplete="off" data-test-readlist-rename-input>
	<p class="readlist-rename__error readlist-rename__error--hidden" role="alert" data-readlist-rename-error data-test-readlist-rename-error></p>
	<div class="readlist-rename__buttons">
		<button class="btn btn--secondary" type="button" popovertarget="{{popoverId}}" popovertargetaction="hide" data-test-action="readlist-rename-cancel">Cancel</button>
		<button class="btn btn--primary" type="submit" data-test-action="readlist-rename-save">Save</button>
	</div>
</form>`;

export function renderReadlistRename(input: { slug: ReadlistSlug; label: string }): string {
	const popoverId = readlistRenamePopoverId(input.slug);
	return renderConfirmPopover({
		id: popoverId,
		key: "readlist-rename",
		subject: input.slug,
		title: "Edit readlist",
		body: "",
		actionsHtml: render(RENAME_ACTIONS_TEMPLATE, {
			action: readlistRenameAction(input.slug),
			inputId: `${popoverId}-name`,
			field: READLIST_RENAME_FIELD,
			label: input.label,
			maxLength: READLIST_LABEL_MAX_LENGTH,
			popoverId,
		}),
	});
}
