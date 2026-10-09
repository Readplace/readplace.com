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

export function renderReadlistRenameForm(input: {
	slug: ReadlistSlug;
	action: string;
	value: string;
	error?: string;
}): string {
	const popoverId = readlistRenamePopoverId(input.slug);
	return renderReadlistNameForm({
		key: "readlist-rename",
		popoverId,
		action: input.action,
		inputId: `${popoverId}-name`,
		value: input.value,
		commitLabel: "Save",
		failureMessage: "Couldn't rename the readlist.",
		error: input.error,
		hiddenFields: [],
	});
}

export function renderReadlistRename(input: { slug: ReadlistSlug; label: string }): string {
	return renderConfirmPopover({
		id: readlistRenamePopoverId(input.slug),
		key: "readlist-rename",
		subject: input.slug,
		title: "Edit readlist",
		body: "",
		actionsHtml: renderReadlistRenameForm({
			slug: input.slug,
			action: readlistRenameAction(input.slug),
			value: input.label,
		}),
	});
}
