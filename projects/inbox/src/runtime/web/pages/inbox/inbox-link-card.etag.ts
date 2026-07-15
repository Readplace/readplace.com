import { createHash } from "node:crypto";
import type { InboxEmailLinkEntry } from "@packages/domain/inbox";

export function computeInboxLinkCardEtag(link: InboxEmailLinkEntry): string {
	const hash = createHash("sha256");
	for (const part of [link.status, link.title ?? ""]) {
		hash.update(part);
		hash.update("|");
	}
	return `W/"${link.ordinal}:${hash.digest("hex").slice(0, 16)}"`;
}
