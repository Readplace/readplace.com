import type { Message } from "../reading-list/reading-list.types";

/** A DOM-free description of how to render the generic server-message view,
 * computed from the server's messages so the decisions (per-message variant
 * class, live-region politeness, empty/hidden) are unit-testable without a DOM.
 * The popup glue maps this onto elements verbatim.
 *
 * `html` is injected as-is by the glue: every `Message.content.body` is trusted,
 * server-authored, server-escaped HTML (see the extension-api-design contract —
 * "Server-Driven Messages Are Trusted HTML"). `role` upgrades to `alert`
 * (assertive) when any message is an error, otherwise stays `status` (polite). */
export interface MessageView {
	readonly hidden: boolean;
	readonly role: "status" | "alert";
	readonly items: ReadonlyArray<{
		readonly className: string;
		readonly html: string;
	}>;
}

export function buildMessageView(messages: Message[]): MessageView {
	const items = messages.map((message) => ({
		className:
			message.type === "error"
				? "messages__item messages__item--error"
				: "messages__item messages__item--warning",
		html: message.content.body,
	}));
	const hasError = messages.some((message) => message.type === "error");
	return {
		hidden: items.length === 0,
		role: hasError ? "alert" : "status",
		items,
	};
}
