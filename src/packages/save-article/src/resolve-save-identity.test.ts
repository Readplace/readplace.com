import type { HutchLogger } from "@packages/hutch-logger";
import type { ClaimCanonicalAlias, FindIdentityRow, IdentityRow } from "@packages/provider-contracts/article-store";
import { initResolveSaveIdentity, type ResolveSaveIdentityDependencies } from "./resolve-save-identity";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const WAYBACK = "https://web.archive.org/web/20081203185222/http://www.onscreenasia.com/article-106.html";
const ORIGINAL = "http://www.onscreenasia.com/article-106.html";
const TRACKER = "https://javascriptweekly.com/link/100000/rss";
const PUBLISHER = "https://sqlite.org/lang_with.html#rcex3";
const ARCHIVE = "https://archive.ph/Ab1cD";

type Harness = {
	resolve: ReturnType<typeof initResolveSaveIdentity>;
	lookups: string[];
	resolverCalls: string[];
	claims: Array<{ aliasUrl: string; targetOriginalUrl: string; now: Date }>;
	warnings: string[];
};

function createHarness(options: {
	rows?: Record<string, IdentityRow>;
	targets?: Record<string, string>;
	claimOutcome?: "claimed" | "occupied";
	rowsAfterClaim?: Record<string, IdentityRow>;
} = {}): Harness {
	const lookups: string[] = [];
	const resolverCalls: string[] = [];
	const claims: Harness["claims"] = [];
	const warnings: string[] = [];
	let rows = options.rows ?? {};
	const findIdentityRow: FindIdentityRow = async (url) => {
		lookups.push(url);
		return rows[url] ?? { kind: "absent" };
	};
	const claimAlias: ClaimCanonicalAlias = async (params) => {
		claims.push(params);
		rows = { ...rows, ...options.rowsAfterClaim };
		return options.claimOutcome ?? "claimed";
	};
	const logger: HutchLogger = {
		info: () => {},
		warn: (line) => {
			warnings.push(String(line));
		},
		error: () => {},
		debug: () => {},
	};
	const deps: ResolveSaveIdentityDependencies = {
		findIdentityRow,
		claimAlias,
		resolveWrapperTarget: async (url) => {
			resolverCalls.push(url);
			return options.targets?.[url];
		},
		now: () => NOW,
		logger,
	};
	return { resolve: initResolveSaveIdentity(deps), lookups, resolverCalls, claims, warnings };
}

describe("initResolveSaveIdentity", () => {
	describe("without touching the network", () => {
		it("keeps a wrapper URL that already has its own article row", async () => {
			const harness = createHarness({ rows: { [TRACKER]: { kind: "article" } } });

			expect(await harness.resolve(TRACKER)).toEqual({ url: TRACKER });
			expect(harness.resolverCalls).toEqual([]);
			expect(harness.claims).toEqual([]);
		});

		it("folds a wrapper already aliased by an earlier save onto that target", async () => {
			const harness = createHarness({ rows: { [TRACKER]: { kind: "alias", targetUrl: PUBLISHER } } });

			expect(await harness.resolve(TRACKER)).toEqual({ url: PUBLISHER });
			expect(harness.resolverCalls).toEqual([]);
		});

		it("keys an archive capture on its original and keeps the capture as the content source", async () => {
			const harness = createHarness();

			expect(await harness.resolve(WAYBACK)).toEqual({ url: ORIGINAL, contentSourceUrl: WAYBACK });
			expect(harness.resolverCalls).toEqual([]);
			expect(harness.claims).toEqual([]);
		});

		it("leaves a plain article URL alone", async () => {
			const harness = createHarness();

			expect(await harness.resolve(PUBLISHER)).toEqual({ url: PUBLISHER });
			expect(harness.resolverCalls).toEqual([]);
			expect(harness.lookups).toEqual([PUBLISHER]);
		});
	});

	describe("an archive URL whose path names the article", () => {
		it("keys a new save on the original even when an earlier save left a row on the capture URL", async () => {
			const harness = createHarness({ rows: { [WAYBACK]: { kind: "article" } } });

			expect(await harness.resolve(WAYBACK)).toEqual({ url: ORIGINAL, contentSourceUrl: WAYBACK });
			expect(harness.lookups).toEqual([ORIGINAL]);
		});

		it("keeps the capture as the content source when the original is aliased onto another article", async () => {
			const harness = createHarness({ rows: { [ORIGINAL]: { kind: "alias", targetUrl: PUBLISHER } } });

			expect(await harness.resolve(WAYBACK)).toEqual({ url: PUBLISHER, contentSourceUrl: WAYBACK });
		});

		it("canonicalises the original's host the way a direct save would", async () => {
			const capture = "https://web.archive.org/web/20230101000000/https://twitter.com/someone/status/1";

			expect(await createHarness().resolve(capture)).toEqual({
				url: "https://x.com/someone/status/1",
				contentSourceUrl: capture,
			});
		});

		describe("naming an original a save would refuse", () => {
			const capture = "https://web.archive.org/web/20230101000000/http://localhost/admin";

			it("keeps the archive URL and asks the archive for the original instead", async () => {
				const harness = createHarness();

				expect(await harness.resolve(capture)).toEqual({ url: capture });
				expect(harness.lookups).toEqual([capture]);
				expect(harness.resolverCalls).toEqual([capture]);
			});

			it("follows an alias already stored on the archive URL", async () => {
				const harness = createHarness({ rows: { [capture]: { kind: "alias", targetUrl: PUBLISHER } } });

				expect(await harness.resolve(capture)).toEqual({ url: PUBLISHER });
				expect(harness.resolverCalls).toEqual([]);
			});
		});
	});

	describe("resolving a wrapper nothing is stored for", () => {
		it("keys the save on the resolved target and claims the wrapper as its alias", async () => {
			const harness = createHarness({ targets: { [TRACKER]: PUBLISHER } });

			expect(await harness.resolve(TRACKER)).toEqual({ url: PUBLISHER, contentSourceUrl: undefined });
			expect(harness.resolverCalls).toEqual([TRACKER]);
			expect(harness.claims).toEqual([{ aliasUrl: TRACKER, targetOriginalUrl: PUBLISHER, now: NOW }]);
			expect(harness.lookups).toEqual([TRACKER, PUBLISHER]);
		});

		it("strips the per-subscriber params a Substack redirect appends before keying", async () => {
			const share = "https://open.substack.com/pub/lcamtuf/p/post";
			const harness = createHarness({
				targets: { [share]: "https://blog.coredump.cx/p/post?r=abc12&utm_source=substack&utm_medium=email" },
			});

			expect(await harness.resolve(share)).toMatchObject({
				url: "https://blog.coredump.cx/p/post?utm_source=substack&utm_medium=email",
			});
			expect(harness.claims[0].targetOriginalUrl).toBe(
				"https://blog.coredump.cx/p/post?utm_source=substack&utm_medium=email",
			);
		});

		it("collapses a Mailchimp 'tweet this' redirect onto the URL being shared", async () => {
			const mailchimp = "https://us12.list-manage.com/track/click?u=abc&id=def&e=sub";
			const harness = createHarness({
				targets: { [mailchimp]: "https://twitter.com/intent/tweet?url=https%3A%2F%2Fpublisher.example%2Farticle&text=Read" },
			});

			expect(await harness.resolve(mailchimp)).toMatchObject({ url: "https://publisher.example/article" });
		});

		it("normalises the target's host the way a direct save would", async () => {
			const harness = createHarness({ targets: { [TRACKER]: "https://SQLite.org/lang_with.html" } });

			expect(await harness.resolve(TRACKER)).toMatchObject({ url: "https://sqlite.org/lang_with.html" });
		});

		it("points the wrapper at the article a crawl already adopted the target into, never at the alias", async () => {
			const firstWrapper = "https://leadershipintech.com/links/1/0b1f0d9c-3b6e-4f9d-9a1e-6f0d5c8e2a11/email";
			const harness = createHarness({
				rows: { [PUBLISHER]: { kind: "alias", targetUrl: firstWrapper } },
				targets: { [TRACKER]: PUBLISHER },
			});

			expect(await harness.resolve(TRACKER)).toMatchObject({ url: firstWrapper });
			expect(harness.claims).toEqual([{ aliasUrl: TRACKER, targetOriginalUrl: firstWrapper, now: NOW }]);
		});

		it("keys an archive short id on the Memento original and pins the snapshot as the content source", async () => {
			const harness = createHarness({ targets: { [ARCHIVE]: "https://publisher.example/article" } });

			expect(await harness.resolve(ARCHIVE)).toEqual({
				url: "https://publisher.example/article",
				contentSourceUrl: ARCHIVE,
			});
		});

		it("keeps the wrapper as the identity when the target cannot be resolved", async () => {
			const harness = createHarness();

			expect(await harness.resolve(TRACKER)).toEqual({ url: TRACKER });
			expect(harness.resolverCalls).toEqual([TRACKER]);
			expect(harness.claims).toEqual([]);
		});

		it.each([
			{ label: "a private-network target", target: "http://localhost/admin", code: "private_network" },
			{ label: "a non-HTTP target", target: "ftp://files.example/a", code: "unsupported_scheme" },
		])("keeps the wrapper and logs the rejection when the resolver hands back $label", async ({ target, code }) => {
			const harness = createHarness({ targets: { [TRACKER]: target } });

			expect(await harness.resolve(TRACKER)).toEqual({ url: TRACKER });
			expect(harness.claims).toEqual([]);
			expect(JSON.parse(harness.warnings[0])).toEqual({
				stream: "wrapper-resolve",
				family: "newsletter-tracker",
				wrapperHost: "javascriptweekly.com",
				outcome: "target-rejected",
				code,
			});
		});

		it("adopts the alias a concurrent save claimed first", async () => {
			const harness = createHarness({
				targets: { [TRACKER]: PUBLISHER },
				claimOutcome: "occupied",
				rowsAfterClaim: { [TRACKER]: { kind: "alias", targetUrl: "https://sqlite.org/other" } },
			});

			expect(await harness.resolve(TRACKER)).toMatchObject({ url: "https://sqlite.org/other" });
		});

		it("keeps the wrapper when an article row landed on it during the resolution", async () => {
			const harness = createHarness({
				targets: { [TRACKER]: PUBLISHER },
				claimOutcome: "occupied",
				rowsAfterClaim: { [TRACKER]: { kind: "article" } },
			});

			expect(await harness.resolve(TRACKER)).toEqual({ url: TRACKER });
		});
	});
});
