import type { EmailAttachment } from "@packages/provider-contracts/email";
import { formatLocalInstant } from "@packages/web-shell";
import type { BookChapter, BuildBookEpub } from "./shared/epub/book-epub";

export type BuildQueueDigestBook = (input: {
	subject: string;
	sendId: string;
	sentAt: Date;
	chapters: readonly BookChapter[];
}) => Promise<EmailAttachment>;

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
