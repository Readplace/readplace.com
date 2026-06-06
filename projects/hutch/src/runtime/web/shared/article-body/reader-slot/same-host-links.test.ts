import { JSDOM } from "jsdom";
import { keepSameHostLinksInSamePage } from "./same-host-links";

function anchors(html: string): HTMLAnchorElement[] {
	const doc = new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window
		.document;
	return Array.from(doc.querySelectorAll("a"));
}

const APP_HOST = "readplace.com";

describe("keepSameHostLinksInSamePage", () => {
	it("forces a same-host target=_blank link to navigate the reader tab (_top)", () => {
		const out = keepSameHostLinksInSamePage({
			html: '<a href="https://readplace.com/queue" target="_blank" rel="noopener">Queue</a>',
			appHost: APP_HOST,
		});
		const [link] = anchors(out);
		expect(link.getAttribute("target")).toBe("_top");
		// The author's other attributes survive the rewrite.
		expect(link.getAttribute("rel")).toBe("noopener");
		expect(link.getAttribute("href")).toBe("https://readplace.com/queue");
	});

	it("forces a same-host link with no target to _top so it cannot be retargeted", () => {
		const out = keepSameHostLinksInSamePage({
			html: '<a href="https://readplace.com/about">About</a>',
			appHost: APP_HOST,
		});
		expect(anchors(out)[0].getAttribute("target")).toBe("_top");
	});

	it("matches the host case-insensitively (URL host is normalised to lower-case)", () => {
		const out = keepSameHostLinksInSamePage({
			html: '<a href="https://READPLACE.com/Caps" target="_blank">Caps</a>',
			appHost: APP_HOST,
		});
		expect(anchors(out)[0].getAttribute("target")).toBe("_top");
	});

	it("leaves an external target=_blank link untouched", () => {
		const out = keepSameHostLinksInSamePage({
			html: '<a href="https://example.com/post" target="_blank" rel="noopener">External</a>',
			appHost: APP_HOST,
		});
		const [link] = anchors(out);
		expect(link.getAttribute("target")).toBe("_blank");
		expect(link.getAttribute("rel")).toBe("noopener");
	});

	it("treats a different subdomain as a different host (staging vs prod)", () => {
		const out = keepSameHostLinksInSamePage({
			html: '<a href="https://staging.readplace.com/x" target="_blank">Staging</a>',
			appHost: APP_HOST,
		});
		expect(anchors(out)[0].getAttribute("target")).toBe("_blank");
	});

	it("classifies same-host links against the staging host when that is the deployment", () => {
		const out = keepSameHostLinksInSamePage({
			html: '<a href="https://staging.readplace.com/x" target="_blank">Staging</a>',
			appHost: "staging.readplace.com",
		});
		expect(anchors(out)[0].getAttribute("target")).toBe("_top");
	});

	it("distinguishes hosts that differ only by port (localhost dev)", () => {
		const out = keepSameHostLinksInSamePage({
			html:
				'<a href="http://localhost:3000/queue" target="_blank">dev</a>' +
				'<a href="http://localhost:4000/queue" target="_blank">other</a>',
			appHost: "localhost:3000",
		});
		const [same, other] = anchors(out);
		expect(same.getAttribute("target")).toBe("_top");
		expect(other.getAttribute("target")).toBe("_blank");
	});

	it("ignores relative, fragment, and non-http hrefs (cannot be classified as same-host)", () => {
		const out = keepSameHostLinksInSamePage({
			html:
				'<a href="/relative">rel</a>' +
				'<a href="#frag">frag</a>' +
				'<a href="mailto:hi@readplace.com">mail</a>',
			appHost: APP_HOST,
		});
		for (const link of anchors(out)) {
			expect(link.hasAttribute("target")).toBe(false);
		}
	});

	it("rewrites only the same-host links in a mixed document", () => {
		const out = keepSameHostLinksInSamePage({
			html:
				'<p>Intro</p>' +
				'<a href="https://readplace.com/a" target="_blank">internal</a>' +
				'<a href="https://example.com/b" target="_blank">external</a>',
			appHost: APP_HOST,
		});
		const [internal, external] = anchors(out);
		expect(internal.getAttribute("target")).toBe("_top");
		expect(external.getAttribute("target")).toBe("_blank");
		expect(out).toContain("<p>Intro</p>");
	});

	it("does not strip the article's own non-anchor tags while rewriting links", () => {
		const out = keepSameHostLinksInSamePage({
			html: '<p>safe</p><style>html{display:none}</style><img onerror="x">',
			appHost: APP_HOST,
		});
		expect(out).toContain("<p>safe</p>");
		expect(out).toContain("<style>html{display:none}</style>");
		expect(out).toContain('<img onerror="x">');
	});

	it("returns content unchanged when there are no links", () => {
		const out = keepSameHostLinksInSamePage({
			html: "<p>Just prose, no links.</p>",
			appHost: APP_HOST,
		});
		expect(out).toBe("<p>Just prose, no links.</p>");
	});
});
