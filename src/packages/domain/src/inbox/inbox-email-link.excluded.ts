import type { InboxEmailLinkEntry } from "./inbox-email-link.types";

export function isExcludedLink(link: Pick<InboxEmailLinkEntry, "status">): boolean {
	return link.status === "skipped";
}
