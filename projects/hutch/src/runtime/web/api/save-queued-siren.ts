import { type SirenEntity, sirenMessages, sirenWarning } from "./siren";

export const SAVE_QUEUED_NOTICE = "This link is queued while Readplace finds the original article.";

export function saveQueuedSirenNotice(): SirenEntity {
	return sirenMessages([sirenWarning(SAVE_QUEUED_NOTICE)]);
}
