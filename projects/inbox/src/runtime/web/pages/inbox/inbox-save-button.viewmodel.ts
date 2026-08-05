import type { InboxLinkSaveState } from "@packages/domain/inbox";

export type SaveButtonState = "saved" | "saving" | "unsaved";

export interface InboxSaveButtonViewModel {
	label: string;
	ariaLabel: string;
	saveState: SaveButtonState;
	iconName: string | undefined;
}

const SAVE_BUTTON_COPY: Record<
	SaveButtonState,
	{ label: string; ariaLabelPrefix: string; iconName: string | undefined }
> = {
	saved: {
		label: "Save again",
		ariaLabelPrefix: "Saved to queue — save again",
		iconName: "check",
	},
	saving: {
		label: "Saving…",
		ariaLabelPrefix: "Saving to queue",
		iconName: undefined,
	},
	unsaved: {
		label: "Save to queue",
		ariaLabelPrefix: "Save to queue",
		iconName: undefined,
	},
};

/** The save button never stops being a save button. A saved link keeps its
 * action, its URL and its method, so re-saving from here is the same POST the
 * unsaved state makes — and lands on the same queue-side upsert the website and
 * the extension re-save through, which bumps `savedAt` and resurfaces a
 * read article as unread. */
export function toInboxSaveButtonViewModel(input: {
	/** Keyed by the link's stored URL. */
	linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
	url: string;
	displayUrl: string;
	whenNotSaved: Exclude<SaveButtonState, "saved">;
}): InboxSaveButtonViewModel {
	const saveState = input.linkSaveStates.get(input.url) === "saved" ? "saved" : input.whenNotSaved;
	const copy = SAVE_BUTTON_COPY[saveState];
	return {
		label: copy.label,
		ariaLabel: `${copy.ariaLabelPrefix}: ${input.displayUrl}`,
		saveState,
		iconName: copy.iconName,
	};
}
