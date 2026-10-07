import { validateSaveableUrl } from "@packages/domain/article";
import type { IdentityRow } from "@packages/provider-contracts/article-store";
import { cleanWrapperTarget, initResolveSaveIdentity } from "./resolve-save-identity";
import type { ResolvedWrapperTarget } from "./resolve-wrapper-target";

const ORIGINAL = "https://publisher.example/article";
const TRACKER = "https://javascriptweekly.com/link/100000/rss";
const ARCHIVE = "https://archive.ph/Ab1cD";
const WAYBACK = `https://web.archive.org/web/20260000000000*/${ORIGINAL}`;

function harness(options: {
	rows?: Record<string, IdentityRow | undefined>;
	targets?: Record<string, ResolvedWrapperTarget>;
	occupied?: IdentityRow;
} = {}) {
	const rows = { ...options.rows };
	const requests: string[] = [];
	const claims: unknown[] = [];
	const resolve = initResolveSaveIdentity({
		validateUrl: validateSaveableUrl,
		findIdentityRow: async (url) => rows[url] ?? { kind: "absent" },
		claimAlias: async (params) => {
			claims.push(params);
			if (options.occupied !== undefined) {
				rows[params.aliasUrl] = options.occupied;
				return;
			}
			rows[params.aliasUrl] = { kind: "alias", targetUrl: params.targetOriginalUrl, sourceBinding: params.sourceBinding };
		},
		resolveWrapperTarget: async (url) => { requests.push(url); return options.targets?.[url]; },
		now: () => new Date("2026-10-01T10:00:00Z"),
	});
	return { resolve, requests, claims };
}

function resolved(url: string, source?: string) {
	return { status: "resolved", url, originalUrl: url, contentSourceUrl: source, sourceOriginalUrl: source === undefined ? undefined : url };
}

describe("save identity", () => {
	it("keeps a plain original", async () => {
		const h = harness();
		expect(await h.resolve(ORIGINAL)).toEqual(resolved(ORIGINAL));
		expect(h.requests).toEqual([]);
		expect(h.claims).toEqual([]);
	});

	it("uses a calendar original despite a legacy wrapper article row", async () => {
		const h = harness({ rows: { [WAYBACK]: { kind: "article" } }, occupied: { kind: "article" } });
		expect(await h.resolve(WAYBACK)).toEqual(resolved(ORIGINAL, `https://web.archive.org/web/${ORIGINAL}`));
		expect(h.requests).toEqual([]);
	});

	it("normalizes the embedded original host", async () => {
		const capture = "https://web.archive.org/web/2026/https://twitter.com/person/status/1";
		expect(await harness().resolve(capture)).toEqual(resolved("https://x.com/person/status/1", capture));
	});

	it.each(["http://localhost/admin", "ftp://files.example/article"])("rejects a wrapper target that cannot be saved: %s", async (target) => {
		const h = harness({ targets: { [TRACKER]: { url: target, contentSourceUrl: TRACKER } } });
		expect(await h.resolve(TRACKER)).toEqual({ status: "unresolved" });
		expect(h.claims).toEqual([]);
	});

	it.each([ARCHIVE, TRACKER, "https://apple.news/story", "https://web.archive.org/about", "https://archive.ph/o/abc/not-an-original"])("leaves an unavailable original unresolved even when a legacy wrapper row exists: %s", async (url) => {
		const h = harness({ rows: { [url]: { kind: "article" } } });
		expect(await h.resolve(url)).toEqual({ status: "unresolved" });
	});

	it("resolves a tracker through an archive to the original", async () => {
		const h = harness({ targets: { [TRACKER]: { url: ARCHIVE, contentSourceUrl: TRACKER }, [ARCHIVE]: { url: ORIGINAL, contentSourceUrl: ARCHIVE } } });
		expect(await h.resolve(TRACKER)).toEqual(resolved(ORIGINAL, TRACKER));
		expect(h.requests).toEqual([TRACKER, ARCHIVE]);
	});

	it("unwraps an archive outbound URL without using its referring article", async () => {
		expect(await harness().resolve(`https://archive.ph/o/Ab1cD/${ORIGINAL}`)).toEqual(resolved(ORIGINAL));
	});

	it("unwraps an intent after a tracker without manufacturing an archive source", async () => {
		const h = harness({ targets: { [TRACKER]: { url: `https://x.com/intent/post?url=${encodeURIComponent(ORIGINAL)}` } } });
		expect(await h.resolve(TRACKER)).toEqual(resolved(ORIGINAL));
	});

	it("strips subscriber parameters before fixing the original identity", async () => {
		const wrapper = "https://open.substack.com/pub/person/p/article";
		const h = harness({ targets: { [wrapper]: { url: `${ORIGINAL}?r=reader&utm_source=email`, contentSourceUrl: wrapper } } });
		expect(await h.resolve(wrapper)).toEqual(resolved(`${ORIGINAL}?utm_source=email`, wrapper));
	});

	it("reuses a verified alias binding for a repeated short-link save without network", async () => {
		const h = harness({ targets: { [ARCHIVE]: { url: ORIGINAL, contentSourceUrl: ARCHIVE } } });
		expect(await h.resolve(ARCHIVE)).toEqual(resolved(ORIGINAL, ARCHIVE));
		h.requests.length = 0;
		expect(await h.resolve(ARCHIVE)).toEqual(resolved(ORIGINAL, ARCHIVE));
		expect(h.requests).toEqual([]);
	});

	it("revalidates a legacy short alias rather than deriving source proof from it", async () => {
		const h = harness({ rows: { [ARCHIVE]: { kind: "alias", targetUrl: ORIGINAL } }, targets: { [ARCHIVE]: { url: ORIGINAL, contentSourceUrl: ARCHIVE } } });
		expect(await h.resolve(ARCHIVE)).toEqual(resolved(ORIGINAL, ARCHIVE));
		expect(h.requests).toEqual([ARCHIVE]);
	});

	it("retains a legacy row key whose adopted original matches the capture", async () => {
		const h = harness({ rows: { [ORIGINAL]: { kind: "alias", targetUrl: TRACKER }, [TRACKER]: { kind: "article", originalUrl: ORIGINAL } } });
		expect(await h.resolve(WAYBACK)).toEqual({ ...resolved(ORIGINAL, `https://web.archive.org/web/${ORIGINAL}`), url: TRACKER });
	});

	it("uses an adopted destination as authoritative for a plain original save", async () => {
		const destination = "https://publisher.example/replacement";
		const h = harness({ rows: { [ORIGINAL]: { kind: "article", originalUrl: destination } } });
		expect(await h.resolve(ORIGINAL)).toEqual({ ...resolved(destination), url: ORIGINAL });
	});

	it.each([
		{ label: "an unadopted wrapper owner", rows: { [ORIGINAL]: { kind: "alias" as const, targetUrl: TRACKER }, [TRACKER]: { kind: "article" as const } } },
		{ label: "an alias pointing to an alias", rows: { [ORIGINAL]: { kind: "alias" as const, targetUrl: TRACKER }, [TRACKER]: { kind: "alias" as const, targetUrl: ORIGINAL } } },
		{ label: "an invalid stored original", rows: { [ORIGINAL]: { kind: "article" as const, originalUrl: "http://localhost/a" } } },
	])("rejects source identity conflicts with $label", async ({ rows }) => {
		expect(await harness({ rows }).resolve(WAYBACK)).toEqual({ status: "unresolved" });
	});

	it.each<{ label: string; submitted: string; targets: Record<string, ResolvedWrapperTarget> }>([
		{ label: "an archive capture", submitted: WAYBACK, targets: {} },
		{ label: "a tracker", submitted: TRACKER, targets: { [TRACKER]: { url: ORIGINAL, contentSourceUrl: TRACKER } } },
	])("lands $label of a former redirecting URL on the adopted article without attaching its source", async ({ submitted, targets }) => {
		const h = harness({ rows: { [ORIGINAL]: { kind: "article", originalUrl: "https://other.example/article" } }, targets });
		expect(await h.resolve(submitted)).toEqual({ ...resolved("https://other.example/article"), url: ORIGINAL });
	});

	it("saves a revalidated opaque original despite an incompatible legacy wrapper alias", async () => {
		const h = harness({ targets: { [ARCHIVE]: { url: ORIGINAL, contentSourceUrl: ARCHIVE } }, occupied: { kind: "alias", targetUrl: "https://other.example/article" } });
		expect(await h.resolve(ARCHIVE)).toEqual(resolved(ORIGINAL, ARCHIVE));
	});

	it("stops a wrapper cycle", async () => {
		const h = harness({ targets: { [ARCHIVE]: { url: TRACKER }, [TRACKER]: { url: ARCHIVE } } });
		expect(await h.resolve(ARCHIVE)).toEqual({ status: "unresolved" });
	});

	it("bounds a chain of distinct wrappers", async () => {
		const targets = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`https://archive.ph/a${index}`, { url: `https://archive.ph/a${index + 1}` }]));
		const h = harness({ targets });
		expect(await h.resolve("https://archive.ph/a0")).toEqual({ status: "unresolved" });
		expect(h.requests).toHaveLength(8);
	});
});

it("cleans a syntactic target for admin recrawl", () => {
	expect(cleanWrapperTarget({ wrapperUrl: ARCHIVE, targetUrl: WAYBACK })).toEqual({ status: "SUCCESS", url: ORIGINAL });
});


it("retains an outer capture through nested syntactic wrapper resolution", async () => {
	const inner = `https://web.archive.org/web/2025/${ORIGINAL}`;
	const outer = `https://archive.ph/newest/${inner}`;
	expect(await harness().resolve(outer)).toEqual(resolved(ORIGINAL, outer));
});
it("resolves a share intent to its original with no content source", async () => {
	const url = `https://x.com/intent/post?url=${encodeURIComponent(ORIGINAL)}`;
	expect(await harness().resolve(url)).toEqual(resolved(ORIGINAL));
});
it("resolves a screenshot alias through its capture rather than using the image as article HTML", async () => {
	const screenshot = `https://archive.ph/Ab1cD/123abc/scr.png`;
	const h = harness({ targets: { [ARCHIVE]: { url: ORIGINAL, contentSourceUrl: ARCHIVE } } });
	expect(await h.resolve(screenshot)).toEqual(resolved(ORIGINAL, ARCHIVE));
});
it("does not replace an outer verified capture with a cached inner binding", async () => {
	const outer = `https://web.archive.org/web/2026/${ARCHIVE}`;
	const h = harness({ rows: { [ARCHIVE]: { kind: "alias", targetUrl: ORIGINAL, sourceBinding: { contentSourceUrl: ARCHIVE, sourceOriginalUrl: ORIGINAL } } } });
	expect(await h.resolve(outer)).toEqual(resolved(ORIGINAL, outer));
});

it("drops a capture of a share intent rather than binding it to the shared original", async () => {
	const capture = `https://web.archive.org/web/2020/https://x.com/intent/post?url=${encodeURIComponent(ORIGINAL)}`;
	expect(await harness().resolve(capture)).toEqual(resolved(ORIGINAL));
});
it("offers the tracker rather than its capture as the source of the tracker's current target", async () => {
	const h = harness({ targets: { [TRACKER]: { url: ORIGINAL } } });
	expect(await h.resolve(`https://web.archive.org/web/2020/${TRACKER}`)).toEqual(resolved(ORIGINAL, TRACKER));
});

it("ignores an old incorrect outbound alias without repointing it", async () => {
	const outbound = `https://archive.ph/o/abc/${ORIGINAL}`;
	const h = harness({ occupied: { kind: "alias", targetUrl: "https://referring.example/article" } });
	expect(await h.resolve(outbound)).toEqual(resolved(ORIGINAL));
	expect(h.claims).toEqual([expect.objectContaining({ aliasUrl: outbound, targetOriginalUrl: ORIGINAL, sourceBinding: undefined })]);
});
