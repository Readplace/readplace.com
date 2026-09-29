import type { InboxEmailLinkEntry } from "./inbox-email-link.types";

export function isExcludedLink(link: Pick<InboxEmailLinkEntry, "status" | "droppedFor">): boolean {
	return link.status === "skipped" || link.droppedFor !== undefined;
}
