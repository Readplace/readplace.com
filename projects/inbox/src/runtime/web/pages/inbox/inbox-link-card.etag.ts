import { createHash } from "node:crypto";
import type { InboxEmailLinkEntry, InboxLinkSaveState } from "@packages/domain/inbox";
import { toInboxLinkCardUrl } from "./inbox-link-card.viewmodel";
import type { InboxLinkCardReadlistFit } from "./inbox-readlist-fit";

/** `saveState` is part of the hash because it is part of the rendered card: a
 * card whose save landed after the reader's last poll would otherwise keep
 * matching its old ETag and never swap in the Saved button. */
export function computeInboxLinkCardEtag(input: {
	link: InboxEmailLinkEntry;
	saveState: InboxLinkSaveState | undefined;
	savedDestination: string | undefined;
	fit: readonly InboxLinkCardReadlistFit[];
}): string {
	const { link, saveState } = input;
	const hash = createHash("sha256");
	const fitParts = input.fit.flatMap(({ readlist, label, outcome, override }) => {
		const entry = outcome.fit.find((candidate) => candidate.ordinal === link.ordinal);
		return [
			readlist,
			label,
			outcome.decision,
			entry?.verdict ?? "none",
			entry?.reason ?? "",
			override?.readerVerdict ?? "none",
			override?.createdAt.toISOString() ?? "",
		];
	});
	for (const part of [link.status, link.title ?? "", toInboxLinkCardUrl({ link, savedDestination: input.savedDestination }), saveState ?? "none", ...fitParts]) {
		hash.update(part);
		hash.update("|");
	}
	return `W/"${link.ordinal}:${hash.digest("hex").slice(0, 16)}"`;
}
