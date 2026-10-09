import type { ReadlistSlug } from "@packages/domain/readlist";
import { renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

import { readlistRenamePath } from "./readlist.url";
import { renderReadlistNameForm } from "./readlist-name-form.component";

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

export function renderReadlistRename(input: { slug: ReadlistSlug; label: string }): string {
	const popoverId = readlistRenamePopoverId(input.slug);
	return renderConfirmPopover({
		id: popoverId,
		key: "readlist-rename",
		subject: input.slug,
		title: "Edit readlist",
		body: "",
		actionsHtml: renderReadlistNameForm({
			key: "readlist-rename",
			popoverId,
			action: readlistRenameAction(input.slug),
			inputId: `${popoverId}-name`,
			value: input.label,
			commitLabel: "Save",
			failureMessage: "Couldn't rename the readlist.",
		}),
	});
}
