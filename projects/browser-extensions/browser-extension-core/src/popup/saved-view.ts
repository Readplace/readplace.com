import type { Message } from "../reading-list/reading-list.types";
import { RENDERABLE_MEDIA_TYPE } from "./message-view";

/** How the saved view paints what the server said about a save. The server owns
 * the words; this owns their weight — the first line is the outcome and carries
 * the view's heading treatment, the rest support it and are set quieter. A
 * server that sends one line gets a heading and nothing else; one that sends
 * three gets a heading and two supporting lines, with no client change. */
export interface SavedViewLine {
	readonly className: string;
	readonly html: string;
}

export function buildSavedView(messages: Message[]): SavedViewLine[] {
	return messages
		.filter((message) => message.content.type === RENDERABLE_MEDIA_TYPE)
		.map((message, index) => ({
			className: index === 0 ? "saved-view__title" : "saved-view__subtitle",
			html: message.content.body,
		}));
}
