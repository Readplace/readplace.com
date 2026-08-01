import type { ReadingListItem } from "./domain/reading-list-item.types";
import type { FindByUrl } from "./reading-list/reading-list.types";
import type { WhenLoggedIn } from "./auth/auth.types";

export interface SetIcon {
	showSaved: (tabId: number) => Promise<void>;
	showNeedsCapture: (tabId: number) => Promise<void>;
	showDefault: (tabId: number) => Promise<void>;
}

function showSavedState(deps: {
	setIcon: SetIcon;
	tabId: number;
	item: ReadingListItem;
}): Promise<void> {
	return deps.item.needsBrowserCapture
		? deps.setIcon.showNeedsCapture(deps.tabId)
		: deps.setIcon.showSaved(deps.tabId);
}

export function initIconStatus(deps: {
	findByUrl: FindByUrl;
	whenLoggedIn: WhenLoggedIn;
	setIcon: SetIcon;
}): { updateIconForTab: (tabId: number, url: string) => Promise<void> } {
	return {
		updateIconForTab: async (tabId, url) => {
			const guarded = deps.whenLoggedIn(() => deps.findByUrl(url));

			if (!guarded.ok) {
				await deps.setIcon.showDefault(tabId);
				return;
			}

			const item = await guarded.value;

			if (item) {
				await showSavedState({ setIcon: deps.setIcon, tabId, item });
			} else {
				await deps.setIcon.showDefault(tabId);
			}
		},
	};
}
