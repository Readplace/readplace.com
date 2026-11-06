import { formatLocalInstant } from "@packages/web-shell";
import type { BuildBookEpub } from "./shared/epub/book-epub";
import type { BuildQueueDigestBook } from "../domain/engagement/digest-email.types";

export type { BuildQueueDigestBook } from "../domain/engagement/digest-email.types";

export function initBuildQueueDigestBook(deps: { buildBookEpub: BuildBookEpub }): BuildQueueDigestBook {
	return async ({ subject, sendId, sentAt, chapters }) => {
		const iso = sentAt.toISOString();
		return {
			filename: `readplace-readlist-${iso.slice(0, 10)}.epub`,
			contentType: "application/epub+zip",
			content: await deps.buildBookEpub({
				title: `${subject} — ${formatLocalInstant({ iso, style: "date", timeZone: "UTC" })}`,
				identifier: `urn:readplace:queue-digest:${sendId}`,
				modifiedAt: sentAt,
				chapters,
			}),
		};
	};
}
