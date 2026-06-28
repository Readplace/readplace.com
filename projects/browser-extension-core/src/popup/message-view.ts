import type { Message } from "../reading-list/reading-list.types";

/** A DOM-free description of how to render the generic server-message view,
 * computed from the server's messages so the decisions (per-message variant
 * class, live-region politeness, empty/hidden, which media types to render) are
 * unit-testable without a DOM. The popup glue maps this onto elements verbatim.
 *
 * `html` is injected as-is by the glue: every rendered `Message.content.body` is
 * trusted, server-authored, server-escaped HTML (see the hypermedia-api-design
 * contract — "Server-Driven Messages Are Trusted HTML"). `role` upgrades to
 * `alert` (assertive) when any rendered message is an error, otherwise stays
 * `status` (polite). */
export interface MessageView {
	readonly hidden: boolean;
	readonly role: "status" | "alert";
	readonly items: ReadonlyArray<{
		readonly className: string;
		readonly html: string;
	}>;
}

/** The one content media type the popup knows how to render. A message whose
 * `content.type` is anything else is ignored — never injected — so the server
 * can adopt a richer media type without older clients mis-rendering an unknown
 * body as HTML. */
const RENDERABLE_MEDIA_TYPE = "text/html";

export function buildMessageView(messages: Message[]): MessageView {
	const renderable = messages.filter(
		(message) => message.content.type === RENDERABLE_MEDIA_TYPE,
	);
	const items = renderable.map((message) => ({
		className:
			message.type === "error"
				? "messages__item messages__item--error"
				: "messages__item messages__item--warning",
		html: message.content.body,
	}));
	const hasError = renderable.some((message) => message.type === "error");
	return {
		hidden: items.length === 0,
		role: hasError ? "alert" : "status",
		items,
	};
}
