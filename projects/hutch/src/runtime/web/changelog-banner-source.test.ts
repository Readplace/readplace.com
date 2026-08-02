import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import {
	type ChangelogBanner,
	isChangelogVersion,
	renderChangelogBannerFragment,
} from "@packages/web-shell";
import { initChangelogBannerSource } from "./changelog-banner-source";

const VERSION = "a1b2c3d4";
assert(isChangelogVersion(VERSION));
const BANNER: ChangelogBanner = {
	hook: "I added keyboard shortcuts to the reader",
	href: "/blog/keyboard-shortcuts?utm_source=changelog-banner&utm_medium=internal&utm_content=read-more",
	version: VERSION,
};

const NEXT_VERSION = "b2c3d4e5";
assert(isChangelogVersion(NEXT_VERSION));
const NEXT_BANNER: ChangelogBanner = {
	hook: "Now with highlights",
	href: "/blog/highlights",
	version: NEXT_VERSION,
};

type FetchResult = { status: number; ok: boolean; text: () => Promise<string> };

function okFragment(banner: ChangelogBanner): FetchResult {
	return { status: 200, ok: true, text: async () => renderChangelogBannerFragment(banner) };
}

function statusOnly(code: number): FetchResult {
	return { status: code, ok: code >= 200 && code < 300, text: async () => "" };
}

function body200(text: string): FetchResult {
	return { status: 200, ok: true, text: async () => text };
}

function capturingLogger(): { logger: HutchLogger; warnings: string[] } {
	const warnings: string[] = [];
	const logger = HutchLogger.from({
		...noopLogger,
		warn: (...args: unknown[]) => {
			warnings.push(String(args[0]));
		},
	});
	return { logger, warnings };
}

const FIXED = {
	sourceUrl: "https://readplace.com/blog/changelog-banner",
	ttlMs: 1000,
	timeoutMs: 800,
};

describe("initChangelogBannerSource", () => {
	it("returns undefined immediately on a cold call and kicks exactly one background fetch", async () => {
		let fetchCount = 0;
		const { getChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger: noopLogger,
			fetch: async () => {
				fetchCount++;
				return okFragment(BANNER);
			},
		});

		expect(await getChangelogBanner()).toBeUndefined();
		expect(fetchCount).toBe(1);
	});

	it("serves the fetched banner once refreshChangelogBanner settles, without refetching inside the TTL", async () => {
		let fetchCount = 0;
		const { getChangelogBanner, refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger: noopLogger,
			fetch: async () => {
				fetchCount++;
				return okFragment(BANNER);
			},
		});

		await refreshChangelogBanner();
		expect(fetchCount).toBe(1);
		expect(await getChangelogBanner()).toEqual(BANNER);
		expect(fetchCount).toBe(1);
	});

	it("serves from cache within the TTL and refetches once it expires", async () => {
		let clock = 0;
		let fetchCount = 0;
		const { getChangelogBanner, refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => clock,
			logger: noopLogger,
			fetch: async () => {
				fetchCount++;
				return okFragment(BANNER);
			},
		});

		await refreshChangelogBanner();
		expect(fetchCount).toBe(1);

		clock = 999; // still inside the 1000ms TTL
		expect(await getChangelogBanner()).toEqual(BANNER);
		expect(fetchCount).toBe(1);

		clock = 1000; // TTL elapsed
		await getChangelogBanner();
		await refreshChangelogBanner();
		expect(fetchCount).toBe(2);
	});

	it("serves the stale banner past the TTL and swaps to the new value once the background refresh settles", async () => {
		let clock = 0;
		const responses = [okFragment(BANNER), okFragment(NEXT_BANNER)];
		let index = 0;
		let fetchCount = 0;
		const { getChangelogBanner, refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => clock,
			logger: noopLogger,
			fetch: async () => {
				fetchCount++;
				return responses[index++];
			},
		});

		await refreshChangelogBanner();
		expect(await getChangelogBanner()).toEqual(BANNER);

		clock = 2000; // past the TTL
		expect(await getChangelogBanner()).toEqual(BANNER);
		expect(fetchCount).toBe(2);

		await refreshChangelogBanner();
		expect(await getChangelogBanner()).toEqual(NEXT_BANNER);
		expect(fetchCount).toBe(2);
	});

	it("keeps serving the old banner in the same request and only retracts once the 204 refresh settles", async () => {
		let clock = 0;
		const responses = [okFragment(BANNER), statusOnly(204)];
		let index = 0;
		const { logger, warnings } = capturingLogger();
		const { getChangelogBanner, refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => clock,
			logger,
			fetch: async () => responses[index++],
		});

		await refreshChangelogBanner();
		expect(await getChangelogBanner()).toEqual(BANNER);

		clock = 2000; // past the TTL
		expect(await getChangelogBanner()).toEqual(BANNER);
		await refreshChangelogBanner();
		expect(await getChangelogBanner()).toBeUndefined();
		expect(warnings).toEqual([]);
	});

	it("treats 204 as 'nothing to announce' without logging a failure", async () => {
		const { logger, warnings } = capturingLogger();
		const { getChangelogBanner, refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger,
			fetch: async () => statusOnly(204),
		});

		await refreshChangelogBanner();
		expect(await getChangelogBanner()).toBeUndefined();
		expect(warnings).toEqual([]);
	});

	it("returns undefined when the source has never succeeded", async () => {
		const { logger, warnings } = capturingLogger();
		const { getChangelogBanner, refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger,
			fetch: async () => statusOnly(503),
		});

		await refreshChangelogBanner();
		expect(await getChangelogBanner()).toBeUndefined();
		expect(warnings.some((w) => w.includes("503"))).toBe(true);
	});

	it("serves stale and restamps the cache on a failed refetch, so a down source is retried at most once per TTL", async () => {
		let clock = 0;
		const responses = [okFragment(BANNER), statusOnly(500)];
		let index = 0;
		let fetchCount = 0;
		const { logger, warnings } = capturingLogger();
		const { getChangelogBanner, refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => clock,
			logger,
			fetch: async () => {
				fetchCount++;
				return responses[index++];
			},
		});

		await refreshChangelogBanner();
		expect(fetchCount).toBe(1);

		clock = 2000; // past the TTL
		expect(await getChangelogBanner()).toEqual(BANNER);
		await refreshChangelogBanner();
		expect(fetchCount).toBe(2);
		expect(warnings.some((w) => w.includes("500"))).toBe(true);

		expect(await getChangelogBanner()).toEqual(BANNER);
		expect(fetchCount).toBe(2);
	});

	it("fails open to the last good value when the fetch rejects (timeout abort)", async () => {
		const { logger, warnings } = capturingLogger();
		const { getChangelogBanner, refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger,
			fetch: async () => {
				throw new Error("The operation was aborted due to timeout");
			},
		});

		await refreshChangelogBanner();
		expect(await getChangelogBanner()).toBeUndefined();
		expect(warnings.some((w) => w.includes("timeout"))).toBe(true);
	});

	it("fails open when the fetch rejects with a non-Error value", async () => {
		const { logger } = capturingLogger();
		const { getChangelogBanner, refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger,
			fetch: () => Promise.reject("boom"),
		});

		await refreshChangelogBanner();
		expect(await getChangelogBanner()).toBeUndefined();
	});

	it("returns undefined and warns when the body is unparseable", async () => {
		const { logger, warnings } = capturingLogger();
		const { getChangelogBanner, refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger,
			fetch: async () => body200("<div>not a banner</div>"),
		});

		await refreshChangelogBanner();
		expect(await getChangelogBanner()).toBeUndefined();
		expect(warnings.some((w) => w.includes("unparseable"))).toBe(true);
	});

	it("dedupes concurrent misses into a single in-flight fetch", async () => {
		let resolveFetch: (result: FetchResult) => void = () => {};
		const pending = new Promise<FetchResult>((resolve) => {
			resolveFetch = resolve;
		});
		let fetchCount = 0;
		const { getChangelogBanner, refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger: noopLogger,
			fetch: async () => {
				fetchCount++;
				return pending;
			},
		});

		await getChangelogBanner();
		await getChangelogBanner();
		expect(fetchCount).toBe(1);

		resolveFetch(okFragment(BANNER));
		await refreshChangelogBanner();
		expect(await getChangelogBanner()).toEqual(BANNER);
		expect(fetchCount).toBe(1);
	});

	it("resolves refreshChangelogBanner without fetching when the cache is still fresh", async () => {
		let fetchCount = 0;
		const { refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger: noopLogger,
			fetch: async () => {
				fetchCount++;
				return okFragment(BANNER);
			},
		});

		await refreshChangelogBanner();
		expect(fetchCount).toBe(1);
		await refreshChangelogBanner();
		expect(fetchCount).toBe(1);
	});

	it("joins an in-flight refresh instead of starting a second fetch", async () => {
		let resolveFetch: (result: FetchResult) => void = () => {};
		const pending = new Promise<FetchResult>((resolve) => {
			resolveFetch = resolve;
		});
		let fetchCount = 0;
		const { refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger: noopLogger,
			fetch: async () => {
				fetchCount++;
				return pending;
			},
		});

		const first = refreshChangelogBanner();
		const second = refreshChangelogBanner();
		expect(fetchCount).toBe(1);

		resolveFetch(okFragment(BANNER));
		await Promise.all([first, second]);
		expect(fetchCount).toBe(1);
	});

	it("never rejects from refreshChangelogBanner, even when the fetch throws", async () => {
		const { logger } = capturingLogger();
		const { refreshChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger,
			fetch: () => Promise.reject(new Error("boom")),
		});

		await expect(refreshChangelogBanner()).resolves.toBeUndefined();
	});
});
