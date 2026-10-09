import { renderConfirmPopover, withInternalTracking } from "@packages/web-shell";

import { renderReadlistNameForm } from "./readlist-name-form.component";

export const READLIST_CREATE_POPOVER_ID = "readlist-create";

export function readlistCreateAction(path: string): string {
	return withInternalTracking(path, { source: "queue-nav", content: "new-readlist" });
}

export function renderReadlistCreate(input: {
	popoverId: string;
	key: string;
	action: string;
}): string {
	return renderConfirmPopover({
		id: input.popoverId,
		key: input.key,
		title: "Create a new readlist",
		body: "",
		actionsHtml: renderReadlistNameForm({
			key: input.key,
			popoverId: input.popoverId,
			action: input.action,
			inputId: `${input.popoverId}-name`,
			value: "",
			commitLabel: "Create readlist",
			failureMessage: "Couldn't create the readlist.",
		}),
	});
}
