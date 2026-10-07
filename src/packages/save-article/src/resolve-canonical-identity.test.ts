import type { FindIdentityRow, IdentityRow } from "@packages/provider-contracts/article-store";
import { initResolveCanonicalIdentity } from "./resolve-canonical-identity";

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

describe("initResolveCanonicalIdentity", () => {
	it("keeps a URL that already has an article row, without unwrapping it", async () => {
		const { findIdentityRow, lookups } = identityRows({ [WAYBACK]: { kind: "article" } });

		expect(await initResolveCanonicalIdentity({ findIdentityRow })(WAYBACK)).toBe(WAYBACK);
		expect(lookups).toEqual([WAYBACK]);
	});

	it("folds an alias onto its target", async () => {
		const { findIdentityRow } = identityRows({ [TRACKER]: { kind: "alias", targetUrl: PUBLISHER } });

		expect(await initResolveCanonicalIdentity({ findIdentityRow })(TRACKER)).toBe(PUBLISHER);
	});

	it("keeps an absent, non-embedding URL after a single lookup", async () => {
		const { findIdentityRow, lookups } = identityRows({});

		expect(await initResolveCanonicalIdentity({ findIdentityRow })(TRACKER)).toBe(TRACKER);
		expect(lookups).toEqual([TRACKER]);
	});

	it("unwraps an absent archive capture to its original", async () => {
		const { findIdentityRow, lookups } = identityRows({});

		expect(await initResolveCanonicalIdentity({ findIdentityRow })(WAYBACK)).toBe(ORIGINAL);
		expect(lookups).toEqual([WAYBACK, ORIGINAL]);
	});

	it("folds the capture's original onto its alias target", async () => {
		const { findIdentityRow } = identityRows({ [ORIGINAL]: { kind: "alias", targetUrl: PUBLISHER } });

		expect(await initResolveCanonicalIdentity({ findIdentityRow })(WAYBACK)).toBe(PUBLISHER);
	});
});
