import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	CHANGELOG_DISMISS_COOKIE_NAME,
	type ChangelogBanner,
	isChangelogVersion,
	parseChangelogBannerFragment,
	readCookie,
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

	it("renders the hidden, empty banner when no banner is present", () => {
		const doc = parse(renderChangelogBannerShell(undefined));
		const banner = doc.querySelector(".changelog-banner");
		assert(banner, "the banner element must always render so layout stays stable");
		expect(banner.classList.contains("changelog-banner--hidden")).toBe(true);
		expect(banner.classList.contains("changelog-banner--visible")).toBe(false);
		expect(banner.children.length).toBe(0);
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
});

describe("readCookie", () => {
	it("reads a single cookie value", () => {
		expect(readCookie(`${CHANGELOG_DISMISS_COOKIE_NAME}=a1b2c3d4`, CHANGELOG_DISMISS_COOKIE_NAME)).toBe(
			"a1b2c3d4",
		);
	});

	it("returns undefined when the header is absent", () => {
		expect(readCookie(undefined, CHANGELOG_DISMISS_COOKIE_NAME)).toBeUndefined();
	});

	it("finds the named cookie among several", () => {
		const header = `session=abc; ${CHANGELOG_DISMISS_COOKIE_NAME}=a1b2c3d4; theme=dark`;
		expect(readCookie(header, CHANGELOG_DISMISS_COOKIE_NAME)).toBe("a1b2c3d4");
	});

	it("returns undefined when the named cookie is not present", () => {
		expect(readCookie("session=abc; theme=dark", CHANGELOG_DISMISS_COOKIE_NAME)).toBeUndefined();
	});

	it("decodes percent-encoded values", () => {
		expect(readCookie("k=a%20b", "k")).toBe("a b");
	});

	it("returns the raw value rather than throwing when it is not a valid percent-escape", () => {
		expect(readCookie("k=%", "k")).toBe("%");
	});
});
