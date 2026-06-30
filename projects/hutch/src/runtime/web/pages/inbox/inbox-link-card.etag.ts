import { createHash } from "node:crypto";
import type { InboxEmailLinkEntry } from "@packages/domain/inbox";

/**
 * Weak ETag over the link identity + every field that mutates while the card
 * polls (status and the crawled preview fields). Sibling of the queue card's
 * `computeQueueCardEtag` minus the wordCount/summary fields a link never has.
 */
export function computeInboxLinkCardEtag(link: InboxEmailLinkEntry): string {
	const hash = createHash("sha256");
	for (const part of [
		link.status,
		link.title ?? "",
		link.excerpt ?? "",
		link.siteName ?? "",
		link.imageUrl ?? "",
		link.failureReason ?? "",
	]) {
		hash.update(part);
		hash.update("|");
	}
	return `W/"${link.ordinal}:${hash.digest("hex").slice(0, 16)}"`;
}
