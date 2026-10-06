import {
	NEWER_READER_VERSION,
	OFFLINE_COPY_PATH_ATTRIBUTE as SHELL_COPY_PATH_ATTRIBUTE,
	OFFLINE_COPY_READER_SOURCE,
	OFFLINE_COPY_SAVED_AT_ATTRIBUTE as SHELL_COPY_SAVED_AT_ATTRIBUTE,
	OFFLINE_SAVED_AT_HEADER as SHELL_SAVED_AT_HEADER,
	READER_SOURCE_MESSAGE_TYPE as SHELL_MESSAGE_TYPE,
	READER_VERSION_MESSAGE_TYPE as SHELL_VERSION_MESSAGE_TYPE,
	REVALIDATE_READER_MESSAGE_TYPE as SHELL_REVALIDATE_MESSAGE_TYPE,
} from "@packages/web-shell";
import { READLIST_PATH } from "../../pages/readlist/readlist.url";
import {
	OFFLINE_CACHE_NAME,
	OFFLINE_CACHE_PREFIX,
	OFFLINE_COPY_PATH_ATTRIBUTE,
	OFFLINE_COPY_SAVED_AT_ATTRIBUTE,
	OFFLINE_READER_SCOPE,
	OFFLINE_SAVED_AT_HEADER,
	OFFLINE_SOURCE_HEADER,
	READER_SOURCE,
	READER_SOURCE_MESSAGE_TYPE,
	READER_VERSION,
	READER_VERSION_MESSAGE_TYPE,
	REVALIDATE_READER_MESSAGE_TYPE,
	isFreshOfflineCopy,
	offlineCacheKey,
	offlinePageKind,
	stampOfflineCopy,
	withoutCampaignParams,
} from "./offline-cache";

const ORIGIN = "https://readplace.com";
const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function copySavedAt(savedAt: string): { headers: Headers } {
	return { headers: new Headers({ [OFFLINE_SAVED_AT_HEADER]: savedAt }) };
}

function networkAnswer(input: { url: string; body: string; headers: Record<string, string> }): Response {
	const answer = new Response(input.body, { status: 200, statusText: "OK", headers: input.headers });
	Object.defineProperty(answer, "url", { value: input.url });
	return answer;
}

describe("offline cache contract", () => {
	it("names the cache with a version behind the prefix a later version is cleaned up by", () => {
		expect(OFFLINE_CACHE_NAME).toBe("readplace-offline-v1");
		expect(OFFLINE_CACHE_PREFIX).toBe("readplace-offline-");
	});

	it("scopes the worker to the path the readlist router is mounted at", () => {
		expect(OFFLINE_READER_SCOPE).toBe(READLIST_PATH);
	});

	it("speaks the same reader-source message the shell's offline banner listens for", () => {
		expect(READER_SOURCE_MESSAGE_TYPE).toBe("readplace:reader-source");
		expect(READER_SOURCE_MESSAGE_TYPE).toBe(SHELL_MESSAGE_TYPE);
		expect(READER_SOURCE).toEqual({ network: "network", offlineCopy: "offline-copy" });
		expect(READER_SOURCE.offlineCopy).toBe(OFFLINE_COPY_READER_SOURCE);
	});

	it("speaks the same reader-version and revalidation messages the shell's newer-version bar uses", () => {
		expect(READER_VERSION_MESSAGE_TYPE).toBe("readplace:reader-version");
		expect(READER_VERSION_MESSAGE_TYPE).toBe(SHELL_VERSION_MESSAGE_TYPE);
		expect(READER_VERSION).toEqual({ same: "same", newer: "newer" });
		expect(READER_VERSION.newer).toBe(NEWER_READER_VERSION);
		expect(REVALIDATE_READER_MESSAGE_TYPE).toBe("readplace:revalidate-reader");
		expect(REVALIDATE_READER_MESSAGE_TYPE).toBe(SHELL_REVALIDATE_MESSAGE_TYPE);
	});

	it("reads the stored copy on screen from the <html> attributes the shell records it on", () => {
		expect(OFFLINE_COPY_PATH_ATTRIBUTE).toBe("data-offline-copy-path");
		expect(OFFLINE_COPY_PATH_ATTRIBUTE).toBe(SHELL_COPY_PATH_ATTRIBUTE);
		expect(OFFLINE_COPY_SAVED_AT_ATTRIBUTE).toBe("data-offline-copy-saved-at");
		expect(OFFLINE_COPY_SAVED_AT_ATTRIBUTE).toBe(SHELL_COPY_SAVED_AT_ATTRIBUTE);
	});

	it("stamps a stored copy with the saved-at header the shell's offline banner tells a stored answer apart by", () => {
		expect(OFFLINE_SAVED_AT_HEADER).toBe("Readplace-Offline-Saved-At");
		expect(OFFLINE_SAVED_AT_HEADER).toBe(SHELL_SAVED_AT_HEADER);
	});
});

describe("offlinePageKind", () => {
	it.each([
		"/queue",
		"/queue?tab=done",
		"/queue?queue=work&order=asc&page=3",
	])("reads %s as the listing", (path) => {
		expect(offlinePageKind(new URL(path, ORIGIN))).toBe("listing");
	});

	it.each([
		"/queue/abc123/view",
		"/queue/abc123/view?v=token",
		"/queue/abc123/view?queue=work&tab=done",
	])("reads %s as a reader", (path) => {
		expect(offlinePageKind(new URL(path, ORIGIN))).toBe("reader");
	});

	it.each([
		"/",
		"/queue/",
		"/queue/counts",
		"/queue/abc123/card",
		"/queue/abc123/reader",
		"/queue/abc123/summary",
		"/queue/abc123/view/extra",
		"/queue/queues/work/preferences",
		"/view/example.com/post",
		"/account",
	])("leaves %s to the network", (path) => {
		expect(offlinePageKind(new URL(path, ORIGIN))).toBeUndefined();
	});
});

describe("offlineCacheKey", () => {
	it("keeps one copy per article, whatever version or return query the link carried", () => {
		const key = `${ORIGIN}/queue/abc123/view`;

		expect(offlineCacheKey(new URL("/queue/abc123/view", ORIGIN))).toBe(key);
		expect(offlineCacheKey(new URL("/queue/abc123/view?v=token", ORIGIN))).toBe(key);
		expect(offlineCacheKey(new URL("/queue/abc123/view?queue=work&tab=done&page=2#top", ORIGIN))).toBe(key);
	});

	it("keys the first page of the unread tab by the bare listing path", () => {
		expect(offlineCacheKey(new URL("/queue", ORIGIN))).toBe(`${ORIGIN}/queue`);
	});

	it("keeps every tab, sort order, page and readlist as its own listing copy", () => {
		const keys = [
			"/queue",
			"/queue?tab=done",
			"/queue?order=asc",
			"/queue?page=2",
			"/queue?tab=done&page=2",
			"/queue?queue=work",
		].map((path) => offlineCacheKey(new URL(path, ORIGIN)));

		expect(keys).toEqual([
			`${ORIGIN}/queue`,
			`${ORIGIN}/queue?tab=done`,
			`${ORIGIN}/queue?order=asc`,
			`${ORIGIN}/queue?page=2`,
			`${ORIGIN}/queue?page=2&tab=done`,
			`${ORIGIN}/queue?queue=work`,
		]);
	});

	it("lands a tracked listing link on the copy the untracked link stored", () => {
		expect(
			offlineCacheKey(
				new URL("/queue?utm_source=header-nav&utm_medium=internal&utm_content=readlist", ORIGIN),
			),
		).toBe(`${ORIGIN}/queue`);
		expect(
			offlineCacheKey(
				new URL("/queue?utm_source=queue-listing&tab=done&utm_content=next&page=2", ORIGIN),
			),
		).toBe(`${ORIGIN}/queue?page=2&tab=done`);
	});

	it("gives one listing copy to the same parameters in any order", () => {
		expect(offlineCacheKey(new URL("/queue?tab=done&page=2&order=asc", ORIGIN))).toBe(
			offlineCacheKey(new URL("/queue?order=asc&page=2&tab=done", ORIGIN)),
		);
	});
});

describe("withoutCampaignParams", () => {
	it("drops the click tracking a link carries and keeps everything that picks the page", () => {
		const tracked = new URL(
			"/queue/abc123/view?queue=work&utm_source=queue-card&utm_medium=internal&v=token&utm_content=open-article-title&utm_term=desktop",
			ORIGIN,
		);

		expect(withoutCampaignParams(tracked).href).toBe(`${ORIGIN}/queue/abc123/view?queue=work&v=token`);
	});

	it("leaves no empty query behind once the tracking was all the link carried", () => {
		const tracked = new URL("/queue?utm_source=queue-listing&utm_medium=internal&utm_content=download-offline", ORIGIN);

		expect(withoutCampaignParams(tracked).href).toBe(`${ORIGIN}/queue`);
	});

	it("leaves the URL it was given untouched", () => {
		const tracked = new URL("/queue?page=2&utm_source=queue-pagination", ORIGIN);

		withoutCampaignParams(tracked);

		expect(tracked.href).toBe(`${ORIGIN}/queue?page=2&utm_source=queue-pagination`);
	});
});

describe("isFreshOfflineCopy", () => {
	it("keeps serving a copy for 30 days after it was saved", () => {
		expect(isFreshOfflineCopy(copySavedAt(new Date(NOW - DAY_MS).toISOString()), NOW)).toBe(true);
		expect(isFreshOfflineCopy(copySavedAt(new Date(NOW - 30 * DAY_MS).toISOString()), NOW)).toBe(true);
	});

	it("stops serving a copy once it is more than 30 days old", () => {
		expect(isFreshOfflineCopy(copySavedAt(new Date(NOW - 30 * DAY_MS - 1).toISOString()), NOW)).toBe(false);
		expect(isFreshOfflineCopy(copySavedAt(new Date(NOW - 400 * DAY_MS).toISOString()), NOW)).toBe(false);
	});

	it("never serves a copy that does not say when it was saved", () => {
		expect(isFreshOfflineCopy({ headers: new Headers() }, NOW)).toBe(false);
		expect(isFreshOfflineCopy(copySavedAt("yesterday"), NOW)).toBe(false);
	});
});

describe("stampOfflineCopy", () => {
	it("keeps the network's answer whole, adding when it was saved and the address it came from", async () => {
		const answer = networkAnswer({
			url: `${ORIGIN}/queue/abc123/view?v=token`,
			body: "<main>Article</main>",
			headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"body-hash"' },
		});

		const stamped = stampOfflineCopy(answer, NOW);

		expect(stamped.status).toBe(200);
		expect(stamped.statusText).toBe("OK");
		expect(stamped.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
		expect(stamped.headers.get("ETag")).toBe('"body-hash"');
		expect(stamped.headers.get(OFFLINE_SAVED_AT_HEADER)).toBe("2026-10-05T12:00:00.000Z");
		expect(stamped.headers.get(OFFLINE_SOURCE_HEADER)).toBe(`${ORIGIN}/queue/abc123/view?v=token`);
		expect(await stamped.text()).toBe("<main>Article</main>");
	});

	it("keeps the address a stored copy recorded when it is stamped again, since a rebuilt copy has no address of its own", async () => {
		const stored = stampOfflineCopy(
			networkAnswer({ url: `${ORIGIN}/queue/abc123/view?v=token`, body: "<main>Article</main>", headers: {} }),
			NOW - 10 * DAY_MS,
		);

		const refreshed = stampOfflineCopy(stored, NOW);

		expect(stored.url).toBe("");
		expect(refreshed.headers.get(OFFLINE_SOURCE_HEADER)).toBe(`${ORIGIN}/queue/abc123/view?v=token`);
		expect(refreshed.headers.get(OFFLINE_SAVED_AT_HEADER)).toBe("2026-10-05T12:00:00.000Z");
		expect(await refreshed.text()).toBe("<main>Article</main>");
	});
});
