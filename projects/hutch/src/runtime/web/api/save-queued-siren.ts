import { type SirenEntity, sirenMessages } from "./siren";

export const SAVE_QUEUED_NOTICE = "This link is queued while Readplace finds the original article.";

export function saveQueuedSirenNotice(): SirenEntity {
	return sirenMessages([
		{
			type: "warning",
			content: { type: "text/html", body: SAVE_QUEUED_NOTICE },
		},
	]);
}
