import { MAX_HTML_BYTES } from "./html-body-limit";
import { fallbackLinkTarget } from "./fallback-link-target";

const TRACKER_URL = "https://tenant.na1.hubspotlinks.com/Ctc/R+113/tenant/TOKEN";
const TRACK_URL =
	"https://tenant.na1.hubspotlinks.com/events/public/v1/encoded/track/tc/R+113/tenant/TOKEN?_ud=TOKEN&_jss=0";

function fallbackPage(href: string): string {
	return `<html><head><script>window.location.replace(atob("TOKEN"));</script></head><body><a href="${href}" rel="noreferrer">Click here</a></body></html>`;
}

function page(params: { html: string; status?: number; contentType?: string }) {
	return {
		response: new Response(null, {
			status: params.status ?? 200,
			headers: { "content-type": params.contentType ?? "text/html;charset=utf-8" },
		}),
		buffer: Buffer.from(params.html),
		documentUrl: TRACKER_URL,
	};
}

describe("fallbackLinkTarget", () => {
	it("returns the one same-host link a script-driven tracker page offers as its fallback", () => {
		expect(fallbackLinkTarget(page({ html: fallbackPage(TRACK_URL) }))).toBe(TRACK_URL);
	});

	it("returns undefined for a page served without a content type", () => {
		const untyped = { response: new Response(null, { status: 200 }), buffer: Buffer.from(fallbackPage(TRACK_URL)), documentUrl: TRACKER_URL };
		expect(fallbackLinkTarget(untyped)).toBeUndefined();
	});

	it("resolves a relative fallback link against the tracker page", () => {
		expect(fallbackLinkTarget(page({ html: fallbackPage("/events/public/v1/encoded/track/tc/R+113/x") }))).toBe(
			"https://tenant.na1.hubspotlinks.com/events/public/v1/encoded/track/tc/R+113/x",
		);
	});

	it("returns undefined for a link to another host", () => {
		expect(fallbackLinkTarget(page({ html: fallbackPage("https://publisher.example/article") }))).toBeUndefined();
	});

	it("returns undefined for a page with more than one link", () => {
		const html = `<html><body><a href="${TRACK_URL}">one</a><a href="${TRACK_URL}&b=1">two</a></body></html>`;

		expect(fallbackLinkTarget(page({ html }))).toBeUndefined();
	});

	it("returns undefined for a page with no link", () => {
		expect(fallbackLinkTarget(page({ html: "<html><body><p>Gone</p></body></html>" }))).toBeUndefined();
	});

	it.each(["javascript:void(0)", "mailto:reader@example.com"])("returns undefined for a fallback link to %s", (href) => {
		expect(fallbackLinkTarget(page({ html: fallbackPage(href) }))).toBeUndefined();
	});

	it("returns undefined for a fallback link that cannot be parsed", () => {
		expect(fallbackLinkTarget(page({ html: fallbackPage("https://exa mple.com:99999/") }))).toBeUndefined();
	});

	it("returns undefined for a page answered with a status other than 200", () => {
		expect(fallbackLinkTarget(page({ html: fallbackPage(TRACK_URL), status: 404 }))).toBeUndefined();
	});

	it("returns undefined for a body that is not HTML", () => {
		expect(
			fallbackLinkTarget(page({ html: '{"href":"x"}', contentType: "application/json" })),
		).toBeUndefined();
	});

	it("returns undefined for a body over the HTML parse cap", () => {
		const html = fallbackPage(TRACK_URL).padEnd(MAX_HTML_BYTES.bytes + 1, " ");

		expect(fallbackLinkTarget(page({ html }))).toBeUndefined();
	});
});
