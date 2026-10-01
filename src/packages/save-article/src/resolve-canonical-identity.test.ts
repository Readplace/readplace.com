import type { FindIdentityRow, IdentityRow } from "@packages/provider-contracts/article-store";
import { initResolveCanonicalIdentity, locateStoredIdentity } from "./resolve-canonical-identity";

const WAYBACK = "https://web.archive.org/web/20081203185222/http://www.onscreenasia.com/article-106.html";
const ORIGINAL = "http://www.onscreenasia.com/article-106.html";
const TRACKER = "https://javascriptweekly.com/link/100000/rss";
const PUBLISHER = "https://sqlite.org/lang_with.html";

function identityRows(rows: Record<string, IdentityRow>): { findIdentityRow: FindIdentityRow; lookups: string[] } {
	const lookups: string[] = [];
	const findIdentityRow: FindIdentityRow = async (url) => {
		lookups.push(url);
		return rows[url] ?? { kind: "absent" };
	};
	return { findIdentityRow, lookups };
}

describe("locateStoredIdentity", () => {
	it("keeps a URL that already has an article row, without unwrapping it", async () => {
		const { findIdentityRow, lookups } = identityRows({ [WAYBACK]: { kind: "article" } });

		expect(await locateStoredIdentity(findIdentityRow, WAYBACK)).toEqual({ url: WAYBACK, row: "article" });
		expect(lookups).toEqual([WAYBACK]);
	});

	it("folds an alias onto its target", async () => {
		const { findIdentityRow } = identityRows({ [TRACKER]: { kind: "alias", targetUrl: PUBLISHER } });

		expect(await locateStoredIdentity(findIdentityRow, TRACKER)).toEqual({ url: PUBLISHER, row: "alias-target" });
	});

	it("reports an absent, non-embedding URL after a single lookup", async () => {
		const { findIdentityRow, lookups } = identityRows({});

		expect(await locateStoredIdentity(findIdentityRow, TRACKER)).toEqual({ url: TRACKER, row: "absent" });
		expect(lookups).toEqual([TRACKER]);
	});

	it("unwraps an absent archive capture to its original and keeps the capture as the content source", async () => {
		const { findIdentityRow, lookups } = identityRows({});

		expect(await locateStoredIdentity(findIdentityRow, WAYBACK)).toEqual({
			url: ORIGINAL,
			row: "absent",
			contentSourceUrl: WAYBACK,
		});
		expect(lookups).toEqual([WAYBACK, ORIGINAL]);
	});

	it("reports the original's article row when the capture's original is already saved", async () => {
		const { findIdentityRow } = identityRows({ [ORIGINAL]: { kind: "article" } });

		expect(await locateStoredIdentity(findIdentityRow, WAYBACK)).toEqual({
			url: ORIGINAL,
			row: "article",
			contentSourceUrl: WAYBACK,
		});
	});

	it("folds the capture's original onto its alias target, dropping the content source", async () => {
		const { findIdentityRow } = identityRows({ [ORIGINAL]: { kind: "alias", targetUrl: PUBLISHER } });

		expect(await locateStoredIdentity(findIdentityRow, WAYBACK)).toEqual({ url: PUBLISHER, row: "alias-target" });
	});
});

describe("initResolveCanonicalIdentity", () => {
	it("returns only the located URL", async () => {
		const { findIdentityRow } = identityRows({ [TRACKER]: { kind: "alias", targetUrl: PUBLISHER } });
		const resolve = initResolveCanonicalIdentity({ findIdentityRow });

		expect(await resolve(TRACKER)).toBe(PUBLISHER);
		expect(await resolve(WAYBACK)).toBe(ORIGINAL);
		expect(await resolve(PUBLISHER)).toBe(PUBLISHER);
	});
});
