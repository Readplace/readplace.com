import { EMAIL_FEATURE } from "@packages/web-shell";
import type { InboxEmailEntry } from "@packages/domain/inbox";
import { type MailTab, buildMailTabs } from "./mail-tabs";

export interface InboxEmailDetailViewModel {
	subject: string;
	sender: string;
	receivedAtLabel: string;
	backHref: string;
	tabs: MailTab[];
	/** A `received` email with its body present renders in the iframe; every
	 * other case (rejected, unparsed, or a body not yet readable from S3) shows
	 * the graceful unavailable panel instead of an empty frame. */
	canRenderBody: boolean;
	bodyHtml: string;
	unavailableMessage: string;
	articlesPlaceholder: string;
}

export function toInboxEmailDetailViewModel(input: {
	entry: InboxEmailEntry;
	bodyHtml: string | undefined;
}): InboxEmailDetailViewModel {
	const canRenderBody = input.entry.status === "received" && input.bodyHtml !== undefined;
	return {
		subject: input.entry.subject === "" ? "(no subject)" : input.entry.subject,
		sender: input.entry.senderEmail === "" ? "(unknown sender)" : input.entry.senderEmail,
		receivedAtLabel: new Date(input.entry.receivedAt).toLocaleString("en-AU", {
			dateStyle: "medium",
			timeStyle: "short",
		}),
		backHref: `/inbox?feature=${EMAIL_FEATURE}`,
		tabs: buildMailTabs("view"),
		canRenderBody,
		bodyHtml: input.bodyHtml ?? "",
		unavailableMessage:
			"This message couldn’t be displayed here; the original email is preserved.",
		articlesPlaceholder: "Links found in this email — available soon.",
	};
}
