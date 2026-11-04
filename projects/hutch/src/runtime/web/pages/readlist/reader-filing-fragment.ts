import { renderReaderReadlistTagsOob } from "../../shared/article-body/article-header/article-header.component";
import { renderReaderReadlistsSlotOob } from "../../shared/article-body/reader-actions/reader-actions.component";
import { type MarkStatusConfirmViewModel, renderMarkStatusConfirm } from "./mark-status-confirm.component";
import type { ReaderReadlistFiling } from "./reader-readlist-filing";
import { renderFilingToast, renderStatusToastMountOob } from "./readlist-mutation-fragments";

export function renderReaderFilingFragment(input: {
	filing: ReaderReadlistFiling;
	markStatusConfirm: MarkStatusConfirmViewModel | undefined;
}): string {
	const { filing, markStatusConfirm } = input;
	return [
		renderReaderReadlistTagsOob(filing.tags),
		renderReaderReadlistsSlotOob(filing.picker),
		markStatusConfirm === undefined
			? ""
			: renderMarkStatusConfirm({ confirm: markStatusConfirm, source: "reader", oob: true }),
		renderStatusToastMountOob(filing.toast === undefined ? "" : renderFilingToast(filing.toast)),
	].join("");
}
