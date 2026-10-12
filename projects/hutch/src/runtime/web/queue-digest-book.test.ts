import type { BuildBookEpub } from "./shared/epub/book-epub";
import { initBuildQueueDigestBook } from "./queue-digest-book";

describe("initBuildQueueDigestBook", () => {
	it("names the book after the email and its send date, identifies it by the send, and attaches it as an EPUB file", async () => {
		const builds: Parameters<BuildBookEpub>[0][] = [];
		const chapters = [
			{
				articleUrl: "https://example.com/a",
				title: "A",
				siteName: "example.com",
				excerpt: "",
				summary: undefined,
				contentHtml: "<p>A</p>",
			},
		];
		const buildQueueDigestBook = initBuildQueueDigestBook({
			buildBookEpub: async (params) => {
				builds.push(params);
				return new Uint8Array([7, 7, 7]);
			},
		});
		const sentAt = new Date("2026-10-12T23:30:00.000Z");

		const attachment = await buildQueueDigestBook({
			subject: "Waiting in your readlist",
			sendId: "msg-1",
			sentAt,
			chapters,
		});

		expect(attachment).toEqual({
			filename: "readplace-readlist-2026-10-12.epub",
			contentType: "application/epub+zip",
			content: new Uint8Array([7, 7, 7]),
		});
		expect(builds).toEqual([
			{
				title: "Waiting in your readlist — Oct 12, 2026",
				identifier: "urn:readplace:queue-digest:msg-1",
				modifiedAt: sentAt,
				chapters,
			},
		]);
	});
});
