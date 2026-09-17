import { READLIST_LABEL_MAX_LENGTH, type ReadlistSlug } from "@packages/domain/readlist";
import { render, renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

import { readlistRenamePath } from "../readlist.url";
import { withDesignFeature } from "./readlist-design-feature";

export const READLIST_DESIGN_RENAME_FIELD = "label";

export const READLIST_DESIGN_RENAME_SCRIPT =
	'<script src="/client-dist/readlist-design.client.js" defer></script>';

export function readlistDesignRenamePopoverId(readlist: ReadlistSlug): string {
	return `readlist-design-rename-${readlist}`;
}

const RENAME_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions readlist-design-rename" method="POST" action="{{action}}" data-readlist-design-rename data-test-form="readlist-rename">
	<label class="readlist-design-rename__label" for="{{inputId}}">Readlist Name</label>
	<input class="readlist-design-rename__input" id="{{inputId}}" type="text" name="{{field}}" value="{{label}}" maxlength="{{maxLength}}" required autocomplete="off" data-test-readlist-rename-input>
	<p class="readlist-design-rename__error readlist-design-rename__error--hidden" role="alert" data-readlist-design-rename-error data-test-readlist-rename-error></p>
	<div class="readlist-design-rename__buttons">
		<button class="btn btn--secondary" type="button" popovertarget="{{popoverId}}" popovertargetaction="hide" data-test-action="readlist-rename-cancel">Cancel</button>
		<button class="btn btn--primary" type="submit" data-test-action="readlist-rename-save">Save</button>
	</div>
</form>`;

export function renderReadlistDesignRename(input: { slug: ReadlistSlug; label: string }): string {
	const popoverId = readlistDesignRenamePopoverId(input.slug);
	return renderConfirmPopover({
		id: popoverId,
		key: "readlist-rename",
		subject: input.slug,
		title: "Edit readlist",
		body: "",
		actionsHtml: render(RENAME_ACTIONS_TEMPLATE, {
			action: withInternalTracking(withDesignFeature(readlistRenamePath(input.slug)), {
				source: "queue-nav",
				content: "rename-readlist",
			}),
			inputId: `${popoverId}-name`,
			field: READLIST_DESIGN_RENAME_FIELD,
			label: input.label,
			maxLength: READLIST_LABEL_MAX_LENGTH,
			popoverId,
		}),
	});
}
