import type { InboxLinkSaveState } from "@packages/domain/inbox";

export type SaveButtonState = "saved" | "unsaved";

export interface InboxSaveButtonViewModel {
	label: string;
	ariaLabel: string;
	saveState: SaveButtonState;
	iconName: string | undefined;
}

/** The save button never stops being a save button. A saved link keeps its
 * action, its URL and its method, so re-saving from here is the same POST the
 * unsaved state makes — and lands on the same queue-side upsert the website and
 * the extension re-save through, which bumps `savedAt` and resurfaces a
 * read article as unread. */
export function toInboxSaveButtonViewModel(input: {
	/** Keyed by the link's stored URL. A link absent from the map, or one whose
	 * save failed, reads as unsaved. */
	linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
	url: string;
	displayUrl: string;
}): InboxSaveButtonViewModel {
	if (input.linkSaveStates.get(input.url) === "saved") {
		return {
			label: "Save again",
			ariaLabel: `Saved to queue — save again: ${input.displayUrl}`,
			saveState: "saved",
			iconName: "check",
		};
	}
	return {
		label: "Save to queue",
		ariaLabel: `Save to queue: ${input.displayUrl}`,
		saveState: "unsaved",
		iconName: undefined,
	};
}
