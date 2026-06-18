import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import {
	type ChangelogBanner,
	renderChangelogBannerFragment,
} from "@packages/web-shell";
import { initChangelogBannerSource } from "./changelog-banner-source";

const BANNER: ChangelogBanner = {
	hook: "I added keyboard shortcuts to the reader",
	href: "/blog/keyboard-shortcuts?utm_source=changelog-banner&utm_medium=internal&utm_content=read-more",
	version: "a1b2c3d4",
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
	it("fetches on the first call and returns the parsed banner", async () => {
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

		expect(await getChangelogBanner()).toEqual(BANNER);
		expect(fetchCount).toBe(1);
	});

	it("serves from cache within the TTL and refetches once it expires", async () => {
		let clock = 0;
		let fetchCount = 0;
		const { getChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => clock,
			logger: noopLogger,
			fetch: async () => {
				fetchCount++;
				return okFragment(BANNER);
			},
		});

		await getChangelogBanner();
		expect(fetchCount).toBe(1);

		clock = 999; // still inside the 1000ms TTL
		await getChangelogBanner();
		expect(fetchCount).toBe(1);

		clock = 1000; // TTL elapsed
		await getChangelogBanner();
		expect(fetchCount).toBe(2);
	});

	it("treats 204 as 'nothing to announce' without logging a failure", async () => {
		const { logger, warnings } = capturingLogger();
		const { getChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger,
			fetch: async () => statusOnly(204),
		});

		expect(await getChangelogBanner()).toBeUndefined();
		expect(warnings).toEqual([]);
	});

	it("retracts a previously good banner when a later refetch returns 204", async () => {
		let clock = 0;
		const responses = [okFragment(BANNER), statusOnly(204)];
		let index = 0;
		const { logger, warnings } = capturingLogger();
		const { getChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => clock,
			logger,
			fetch: async () => responses[index++],
		});

		expect(await getChangelogBanner()).toEqual(BANNER);
		clock = 2000; // force a refetch past the TTL
		expect(await getChangelogBanner()).toBeUndefined();
		expect(warnings).toEqual([]);
	});

	it("returns undefined when the source has never succeeded", async () => {
		const { logger, warnings } = capturingLogger();
		const { getChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger,
			fetch: async () => statusOnly(503),
		});

		expect(await getChangelogBanner()).toBeUndefined();
		expect(warnings.some((w) => w.includes("503"))).toBe(true);
	});

	it("keeps serving the last good banner when a later refetch returns an error status", async () => {
		let clock = 0;
		const responses = [okFragment(BANNER), statusOnly(500)];
		let index = 0;
		const { logger, warnings } = capturingLogger();
		const { getChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => clock,
			logger,
			fetch: async () => responses[index++],
		});

		expect(await getChangelogBanner()).toEqual(BANNER);
		clock = 2000; // force a refetch
		expect(await getChangelogBanner()).toEqual(BANNER);
		expect(warnings.some((w) => w.includes("500"))).toBe(true);
	});

	it("fails open to the last good value when the fetch rejects (timeout abort)", async () => {
		const { logger, warnings } = capturingLogger();
		const { getChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger,
			fetch: async () => {
				throw new Error("The operation was aborted due to timeout");
			},
		});

		expect(await getChangelogBanner()).toBeUndefined();
		expect(warnings.some((w) => w.includes("timeout"))).toBe(true);
	});

	it("fails open when the fetch rejects with a non-Error value", async () => {
		const { logger } = capturingLogger();
		const { getChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger,
			fetch: () => Promise.reject("boom"),
		});

		expect(await getChangelogBanner()).toBeUndefined();
	});

	it("returns undefined and warns when the body is unparseable", async () => {
		const { logger, warnings } = capturingLogger();
		const { getChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger,
			fetch: async () => body200("<div>not a banner</div>"),
		});

		expect(await getChangelogBanner()).toBeUndefined();
		expect(warnings.some((w) => w.includes("unparseable"))).toBe(true);
	});

	it("dedupes concurrent misses into a single in-flight fetch", async () => {
		let resolveFetch: (result: FetchResult) => void = () => {};
		const pending = new Promise<FetchResult>((resolve) => {
			resolveFetch = resolve;
		});
		let fetchCount = 0;
		const { getChangelogBanner } = initChangelogBannerSource({
			...FIXED,
			now: () => 0,
			logger: noopLogger,
			fetch: async () => {
				fetchCount++;
				return pending;
			},
		});

		const first = getChangelogBanner();
		const second = getChangelogBanner();
		resolveFetch(okFragment(BANNER));
		const [a, b] = await Promise.all([first, second]);

		expect(fetchCount).toBe(1);
		expect(a).toEqual(BANNER);
		expect(b).toEqual(BANNER);
	});
});
