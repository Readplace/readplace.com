import { resolveCanonicalUrl } from "./resolve-canonical-url";

/* Regression guard for the duplicate-reader-state class: one article reachable
 * under several equivalent URLs must collapse to ONE canonical identity so a
 * crawl and an extension save of the same page key the same row. Two signals
 * feed the decision — the server-issued redirect target (finalUrl) and the
 * page's declared <link rel=canonical>/og:url — with a same-host guard against
 * identity hijack and an over-aliasing guard against homepage-canonical
 * whole-site collapse. See issues #854 (nixos), Medium /p/<id>, thehill 308. */
describe("resolveCanonicalUrl", () => {
	it("honors a same-host rel=canonical that changes identity (nixos Nix_Channels → Nix_channels)", () => {
		expect(
			resolveCanonicalUrl({
				requestedUrl: "https://nixos.wiki/wiki/Nix_Channels",
				linkCanonicalHref: "https://nixos.wiki/wiki/Nix_channels",
			}),
		).toBe("https://nixos.wiki/wiki/Nix_channels");
	});

	it("resolves a relative canonical href against the requested URL", () => {
		expect(
			resolveCanonicalUrl({
				requestedUrl: "https://nixos.wiki/wiki/Nix_Channels",
				linkCanonicalHref: "/wiki/Nix_channels",
			}),
		).toBe("https://nixos.wiki/wiki/Nix_channels");
	});

	it("collapses a trailing-slash 308 redirect target (thehill) when only the redirect is known", () => {
		expect(
			resolveCanonicalUrl({
				requestedUrl: "https://thehill.com/a/five-points",
				finalUrl: "https://thehill.com/a/five-points/",
			}),
		).toBe("https://thehill.com/a/five-points/");
	});

	it("follows a cross-host redirect target (medium.com/p/<id> → custom domain) via finalUrl", () => {
		expect(
			resolveCanonicalUrl({
				requestedUrl: "https://medium.com/p/9aceb0bdee03",
				finalUrl: "https://fagnerbrack.com/learn-sql-once-9aceb0bdee03",
			}),
		).toBe("https://fagnerbrack.com/learn-sql-once-9aceb0bdee03");
	});

	it("honors a rel=canonical declared by the redirected page (base is finalUrl, not the requested host)", () => {
		expect(
			resolveCanonicalUrl({
				requestedUrl: "https://medium.com/p/9aceb0bdee03",
				finalUrl: "https://fagnerbrack.com/learn-sql-once-9aceb0bdee03",
				linkCanonicalHref: "https://fagnerbrack.com/learn-sql-once-9aceb0bdee03",
			}),
		).toBe("https://fagnerbrack.com/learn-sql-once-9aceb0bdee03");
	});

	it("falls back to og:url when there is no canonical link (AMP mirror → canonical)", () => {
		expect(
			resolveCanonicalUrl({
				requestedUrl: "https://site.example/amp/post",
				ogUrl: "https://site.example/post",
			}),
		).toBe("https://site.example/post");
	});

	it("ignores a cross-host rel=canonical when no redirect corroborates it (identity hijack guard)", () => {
		expect(
			resolveCanonicalUrl({
				requestedUrl: "https://victim.example/article",
				linkCanonicalHref: "https://evil.example/owned",
			}),
		).toBe("https://victim.example/article");
	});

	it("ignores a homepage-root canonical for a deep article (whole-site over-aliasing guard)", () => {
		expect(
			resolveCanonicalUrl({
				requestedUrl: "https://blog.example/deep/post",
				linkCanonicalHref: "https://blog.example/",
			}),
		).toBe("https://blog.example/deep/post");
	});

	it("keeps the requested URL when the canonical normalizes to the same identity (no-op)", () => {
		expect(
			resolveCanonicalUrl({
				requestedUrl: "https://x.com/a",
				linkCanonicalHref: "http://x.com/a#section",
			}),
		).toBe("https://x.com/a");
	});

	it("keeps the requested URL when the redirect lands on the same identity (extension already post-redirect)", () => {
		expect(
			resolveCanonicalUrl({ requestedUrl: "https://x.com/a", finalUrl: "https://x.com/a" }),
		).toBe("https://x.com/a");
	});

	it("keeps the requested URL when no signals are present", () => {
		expect(resolveCanonicalUrl({ requestedUrl: "https://x.com/a" })).toBe("https://x.com/a");
	});

	it("keeps the requested URL when the declared canonical href is malformed", () => {
		expect(
			resolveCanonicalUrl({ requestedUrl: "https://x.com/a", linkCanonicalHref: "http://[invalid" }),
		).toBe("https://x.com/a");
	});

	it("keeps the requested URL when finalUrl is malformed", () => {
		expect(
			resolveCanonicalUrl({ requestedUrl: "https://x.com/a", finalUrl: "http://[invalid" }),
		).toBe("https://x.com/a");
	});

	it("keeps the requested URL when canonical/og tags carry no usable value", () => {
		expect(
			resolveCanonicalUrl({ requestedUrl: "https://x.com/a", linkCanonicalHref: " ", ogUrl: "" }),
		).toBe("https://x.com/a");
	});

	it("allows a root→root cross-host redirect (both homepages, guard does not apply)", () => {
		expect(
			resolveCanonicalUrl({ requestedUrl: "https://old.example/", finalUrl: "https://new.example/" }),
		).toBe("https://new.example/");
	});
});
