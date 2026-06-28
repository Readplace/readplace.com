import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	CHANGELOG_SEEN_SCRIPT,
	CHANGELOG_SEEN_STORAGE_KEY,
	type ChangelogBanner,
	isChangelogVersion,
	parseChangelogBannerFragment,
	renderChangelogBannerFragment,
	renderChangelogBannerShell,
} from "./changelog-banner";

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

const VERSION = "a1b2c3d4";
assert(isChangelogVersion(VERSION));
const BANNER: ChangelogBanner = {
	hook: "I added keyboard shortcuts to the reader",
	href: "/blog/keyboard-shortcuts?utm_source=changelog-banner&utm_medium=internal&utm_content=read-more",
	version: VERSION,
};

describe("renderChangelogBannerFragment", () => {
	it("carries the version on the root data attribute", () => {
		const doc = parse(renderChangelogBannerFragment(BANNER));
		const root = doc.querySelector("[data-changelog-version]");
		assert(root, "fragment must have a versioned root");
		expect(root.getAttribute("data-changelog-version")).toBe("a1b2c3d4");
	});

	it("escapes the hook as text so markup in the copy cannot break out", () => {
		const doc = parse(
			renderChangelogBannerFragment({ ...BANNER, hook: "a <b> & \"c\"" }),
		);
		const hook = doc.querySelector("[data-changelog-hook]");
		assert(hook, "fragment must carry the hook");
		expect(hook.textContent).toBe('a <b> & "c"');
	});

	it("renders the href on the link, preserving the query string", () => {
		const doc = parse(renderChangelogBannerFragment(BANNER));
		const link = doc.querySelector("a");
		assert(link, "fragment must carry a link");
		expect(link.getAttribute("href")).toBe(BANNER.href);
	});

	it("round-trips through parseChangelogBannerFragment unchanged", () => {
		expect(parseChangelogBannerFragment(renderChangelogBannerFragment(BANNER))).toEqual(BANNER);
	});
});

describe("parseChangelogBannerFragment", () => {
	it("parses a well-formed fragment", () => {
		const html = renderChangelogBannerFragment(BANNER);
		expect(parseChangelogBannerFragment(html)).toEqual(BANNER);
	});

	it("returns undefined for garbage with no root element", () => {
		expect(parseChangelogBannerFragment("just text, no element")).toBeUndefined();
	});

	it("returns undefined when the version attribute is missing", () => {
		expect(
			parseChangelogBannerFragment(
				`<div><span data-changelog-hook>hi</span><a href="/blog/x">Read more</a></div>`,
			),
		).toBeUndefined();
	});

	it("returns undefined when the version fails the 8-hex-char shape", () => {
		expect(
			parseChangelogBannerFragment(
				`<div data-changelog-version="not-hex!"><span data-changelog-hook>hi</span><a href="/blog/x">Read more</a></div>`,
			),
		).toBeUndefined();
	});

	it("returns undefined when the hook element is missing", () => {
		expect(
			parseChangelogBannerFragment(
				`<div data-changelog-version="a1b2c3d4"><a href="/blog/x">Read more</a></div>`,
			),
		).toBeUndefined();
	});

	it("returns undefined when the link is missing", () => {
		expect(
			parseChangelogBannerFragment(
				`<div data-changelog-version="a1b2c3d4"><span data-changelog-hook>hi</span></div>`,
			),
		).toBeUndefined();
	});

	it("returns undefined when the link has no href", () => {
		expect(
			parseChangelogBannerFragment(
				`<div data-changelog-version="a1b2c3d4"><span data-changelog-hook>hi</span><a>Read more</a></div>`,
			),
		).toBeUndefined();
	});

	it("returns undefined for an absolute (non-root-relative) href", () => {
		expect(
			parseChangelogBannerFragment(
				`<div data-changelog-version="a1b2c3d4"><span data-changelog-hook>hi</span><a href="https://evil.example/x">Read more</a></div>`,
			),
		).toBeUndefined();
	});

	it("returns undefined for a protocol-relative href", () => {
		expect(
			parseChangelogBannerFragment(
				`<div data-changelog-version="a1b2c3d4"><span data-changelog-hook>hi</span><a href="//evil.example/x">Read more</a></div>`,
			),
		).toBeUndefined();
	});
});

describe("isChangelogVersion", () => {
	it("accepts exactly eight lowercase hex characters", () => {
		expect(isChangelogVersion("a1b2c3d4")).toBe(true);
	});

	it("rejects a non-string value", () => {
		expect(isChangelogVersion(undefined)).toBe(false);
		expect(isChangelogVersion(null)).toBe(false);
		expect(isChangelogVersion(0xa1b2c3d4)).toBe(false);
	});

	it("rejects the wrong length, uppercase, or non-hex characters", () => {
		expect(isChangelogVersion("a1b2c3d")).toBe(false);
		expect(isChangelogVersion("a1b2c3d4e")).toBe(false);
		expect(isChangelogVersion("A1B2C3D4")).toBe(false);
		expect(isChangelogVersion("zzzzzzzz")).toBe(false);
	});
});

describe("renderChangelogBannerShell", () => {
	it("renders the visible banner with content when a banner is present", () => {
		const doc = parse(renderChangelogBannerShell(BANNER));
		const banner = doc.querySelector(".changelog-banner");
		assert(banner, "the banner element must always render");
		expect(banner.classList.contains("changelog-banner--visible")).toBe(true);
		expect(banner.classList.contains("changelog-banner--hidden")).toBe(false);
	});

	it("carries the rendered version on the visible banner so the seen-script can read it", () => {
		const doc = parse(renderChangelogBannerShell(BANNER));
		const banner = doc.querySelector(".changelog-banner");
		assert(banner, "the banner element must render");
		expect(banner.getAttribute("data-changelog-version")).toBe(VERSION);
	});

	it("emits the inline seen-script as the visible banner's last child", () => {
		const doc = parse(renderChangelogBannerShell(BANNER));
		const banner = doc.querySelector(".changelog-banner");
		assert(banner, "the banner element must render");
		const last = banner.lastElementChild;
		assert(last, "the visible banner must have children");
		expect(last.tagName).toBe("SCRIPT");
		expect(last.textContent).toBe(CHANGELOG_SEEN_SCRIPT);
	});

	it("renders the hidden, empty banner when no banner is present", () => {
		const doc = parse(renderChangelogBannerShell(undefined));
		const banner = doc.querySelector(".changelog-banner");
		assert(banner, "the banner element must always render so layout stays stable");
		expect(banner.classList.contains("changelog-banner--hidden")).toBe(true);
		expect(banner.classList.contains("changelog-banner--visible")).toBe(false);
		expect(banner.children.length).toBe(0);
		expect(banner.hasAttribute("data-changelog-version")).toBe(false);
	});

	it("uses role=status with a polite live region for assistive tech", () => {
		const doc = parse(renderChangelogBannerShell(BANNER));
		const banner = doc.querySelector(".changelog-banner");
		assert(banner, "the banner element must render");
		expect(banner.getAttribute("role")).toBe("status");
		expect(banner.getAttribute("aria-live")).toBe("polite");
	});

	it("renders the NEW chip as aria-hidden decorative novelty", () => {
		const doc = parse(renderChangelogBannerShell(BANNER));
		const chip = doc.querySelector(".changelog-banner__chip");
		assert(chip, "the NEW chip must render");
		expect(chip.textContent).toBe("NEW");
		expect(chip.getAttribute("aria-hidden")).toBe("true");
	});

	it("renders the escaped hook as text", () => {
		const doc = parse(renderChangelogBannerShell({ ...BANNER, hook: "a <b> & c" }));
		const hook = doc.querySelector(".changelog-banner__hook");
		assert(hook, "the hook must render");
		expect(hook.textContent).toBe("a <b> & c");
	});

	it("links 'Read more' to the banner href", () => {
		const doc = parse(renderChangelogBannerShell(BANNER));
		const link = doc.querySelector(".changelog-banner__link");
		assert(link, "the read-more link must render");
		expect(link.getAttribute("href")).toBe(BANNER.href);
	});

	it("dismisses via a POST form that carries the rendered version", () => {
		const doc = parse(renderChangelogBannerShell(BANNER));
		const form = doc.querySelector(".changelog-banner__dismiss");
		assert(form, "the dismiss form must render");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe("/banner/changelog/dismiss");
		const version = form.querySelector('input[name="version"]');
		assert(version, "the dismiss form must post the version");
		expect(version.getAttribute("value")).toBe("a1b2c3d4");
	});

	it("labels the close button for assistive tech", () => {
		const doc = parse(renderChangelogBannerShell(BANNER));
		const close = doc.querySelector(".changelog-banner__close");
		assert(close, "the close button must render");
		expect(close.getAttribute("aria-label")).toBe("Dismiss changelog banner");
	});

	it("carries the return path as a hidden field so dismissing returns the reader to the page they were on", () => {
		const doc = parse(
			renderChangelogBannerShell(BANNER, "/blog/keyboard-shortcuts?utm_source=changelog-banner"),
		);
		const returnTo = doc.querySelector('.changelog-banner__dismiss input[name="returnTo"]');
		assert(returnTo, "the dismiss form must post the return path");
		expect(returnTo.getAttribute("value")).toBe(
			"/blog/keyboard-shortcuts?utm_source=changelog-banner",
		);
	});

	it("escapes the return path in the hidden field so a crafted path cannot break out of the attribute", () => {
		const doc = parse(renderChangelogBannerShell(BANNER, '/x?a="1"&b=<2>'));
		const returnTo = doc.querySelector('.changelog-banner__dismiss input[name="returnTo"]');
		assert(returnTo, "the dismiss form must post the return path");
		expect(returnTo.getAttribute("value")).toBe('/x?a="1"&b=<2>');
	});

	it("renders an empty return path when none is supplied so the dismiss route falls back to /", () => {
		const doc = parse(renderChangelogBannerShell(BANNER));
		const returnTo = doc.querySelector('.changelog-banner__dismiss input[name="returnTo"]');
		assert(returnTo, "the dismiss form must always carry the return-path input");
		expect(returnTo.getAttribute("value")).toBe("");
	});
});

describe("CHANGELOG_SEEN_SCRIPT", () => {
	function load(banner: ChangelogBanner): JSDOM {
		return new JSDOM(`<!doctype html><html><body>${renderChangelogBannerShell(banner)}</body></html>`, {
			url: "https://readplace.com/",
			runScripts: "outside-only",
		});
	}

	function seenClass(dom: JSDOM): boolean {
		const banner = dom.window.document.querySelector(".changelog-banner");
		assert(banner, "the banner must render");
		return banner.classList.contains("changelog-banner--seen");
	}

	it("leaves NEW visible and records the version on the first sight", () => {
		const dom = load(BANNER);
		dom.window.eval(CHANGELOG_SEEN_SCRIPT);
		expect(seenClass(dom)).toBe(false);
		expect(dom.window.localStorage.getItem(CHANGELOG_SEEN_STORAGE_KEY)).toBe(VERSION);
	});

	it("hides NEW on a later load of the same version", () => {
		const dom = load(BANNER);
		dom.window.eval(CHANGELOG_SEEN_SCRIPT);
		dom.window.document.body.innerHTML = renderChangelogBannerShell(BANNER);
		dom.window.eval(CHANGELOG_SEEN_SCRIPT);
		expect(seenClass(dom)).toBe(true);
	});

	it("re-shows NEW and records the new version when a newer post arrives", () => {
		const newer = "ffffffff";
		assert(isChangelogVersion(newer));
		const dom = load(BANNER);
		dom.window.eval(CHANGELOG_SEEN_SCRIPT);
		dom.window.document.body.innerHTML = renderChangelogBannerShell({ ...BANNER, version: newer });
		dom.window.eval(CHANGELOG_SEEN_SCRIPT);
		expect(seenClass(dom)).toBe(false);
		expect(dom.window.localStorage.getItem(CHANGELOG_SEEN_STORAGE_KEY)).toBe(newer);
	});

	it("does nothing when there is no visible banner to mark", () => {
		const dom = new JSDOM(
			`<!doctype html><html><body>${renderChangelogBannerShell(undefined)}</body></html>`,
			{ url: "https://readplace.com/", runScripts: "outside-only" },
		);
		dom.window.eval(CHANGELOG_SEEN_SCRIPT);
		expect(dom.window.localStorage.getItem(CHANGELOG_SEEN_STORAGE_KEY)).toBeNull();
	});

	it("swallows a throwing storage so NEW stays visible in private mode", () => {
		const dom = load(BANNER);
		dom.window.localStorage.getItem = () => {
			throw new Error("storage blocked");
		};
		expect(() => dom.window.eval(CHANGELOG_SEEN_SCRIPT)).not.toThrow();
		expect(seenClass(dom)).toBe(false);
	});
});
