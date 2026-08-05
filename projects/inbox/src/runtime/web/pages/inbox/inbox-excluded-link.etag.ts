import { createHash } from "node:crypto";
import type { InboxEmailLinkEntry, InboxLinkSaveState } from "@packages/domain/inbox";

export function computeInboxExcludedRowEtag(input: {
	link: InboxEmailLinkEntry;
	saveState: InboxLinkSaveState | undefined;
}): string {
	const { link, saveState } = input;
	const hash = createHash("sha256");
	for (const part of [link.status, link.skipReason ?? "", saveState ?? "none"]) {
		hash.update(part);
		hash.update("|");
	}
	return `W/"${link.ordinal}:${hash.digest("hex").slice(0, 16)}"`;
}
